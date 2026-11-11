/* Kestrel Marketing Cloud - application shell: sidebar + phone top bar, sim clock and speed,
   agent pulse, theme, approvals drawer, toasts, bare-hash router, error boundaries, boot.
   Sample tenant: Fernway Outfitters (fictional; every number is simulated). */
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
  var SPEEDS = [
    { value: 'pause', label: 'Pause', ariaLabel: 'Pause' },
    { value: '1x', label: '1×', ariaLabel: 'Real-time speed, 1 times' },
    { value: '4x', label: '4×', ariaLabel: '4 times speed' },
    { value: '16x', label: '16×', ariaLabel: '16 times speed' }
  ];
  var THEMES = [
    { value: 'system', label: 'System', icon: 'monitor', ariaLabel: 'System theme' },
    { value: 'light', label: 'Light', icon: 'sun', ariaLabel: 'Light theme' },
    { value: 'dark', label: 'Dark', icon: 'moon', ariaLabel: 'Dark theme' }
  ];

  /* ---------------- selectors (module-level, stable) ---------------- */
  function selReady(w) { return !!w; }
  function selTick(w) { return w && w.meta ? w.meta.tick : 0; }
  function selOpenCount(w) { return w && w.proposals && w.proposals.open ? w.proposals.open.length : 0; }
  function selProposals(w) { return w ? w.proposals : null; }
  function selCampaigns(w) { return w ? w.campaigns : null; }
  function selRoute(s) { return s.route; }
  function selDrawer(s) { return s.drawer; }
  function selTheme(s) { return s.theme; }
  function selSample(s) { return s.sampleDismissed; }
  function selVerifying(s) { return s.verifying; }
  function selCampFocus(s) { return s.focus && s.focus.campaigns; }

  /* ---------------- engine speed (lives outside the world) ---------------- */
  function readSpeed() {
    try { return MC.engine && typeof MC.engine.getSpeed === 'function' ? MC.engine.getSpeed() : 'pause'; } catch (e) { return 'pause'; }
  }
  var speedSubs = [];
  function notifySpeed() { speedSubs.slice().forEach(function (fn) { fn(); }); }
  function useSpeed() {
    var st = useState(readSpeed), speed = st[0], set = st[1];
    useEffect(function () {
      function sync() { var s = readSpeed(); set(function (p) { return p === s ? p : s; }); }
      speedSubs.push(sync);
      var unsub = MC.store.subscribe(sync);
      var unsubE = MC.engine && typeof MC.engine.subscribe === 'function' ? MC.engine.subscribe(sync) : null;
      sync();
      return function () { unsub(); if (unsubE) unsubE(); var i = speedSubs.indexOf(sync); if (i >= 0) speedSubs.splice(i, 1); };
    }, []);
    return speed;
  }
  function setSpeed(key) {
    try { if (MC.engine && typeof MC.engine.setSpeed === 'function') MC.engine.setSpeed(key); } catch (e) { report(e); }
    notifySpeed();
  }
  function stepOnce() {
    try { if (MC.engine && typeof MC.engine.step === 'function') MC.engine.step(1); } catch (e) { report(e); }
    notifySpeed();
  }
  function hasEngine() { return !!(MC.engine && typeof MC.engine.setSpeed === 'function'); }
  function report(e) { if (window.console && console.error) console.error(e); }

  /* ---------------- clock ---------------- */
  function clockText(t) {
    if (MC.fmt && MC.fmt.clock) return MC.fmt.clock(t);
    if (MC.fmt && MC.fmt.date && MC.fmt.time) return MC.fmt.date(t) + ' ' + DOT + ' ' + MC.fmt.time(t);
    return 'Hour ' + t;
  }
  function compactClock(t) {
    if (MC.fmt && MC.fmt.stamp) return MC.fmt.stamp(t).replace(' ' + DOT + ' ', ' ');
    return clockText(t);
  }
  function simDay(t) { return MC.time && MC.time.simDay ? MC.time.simDay(t) : Math.floor(t / 24) + 1; }

  function SimClock(p) {
    var tick = useSel(selTick) || 0;
    var speed = useSpeed();
    var verifying = useUi(selVerifying);
    var paused = speed === 'pause';
    if (p.compact) {
      return html`<span className="app-clock app-clock--compact num" aria-label=${'Simulated time ' + clockText(tick) + (paused ? ', paused' : '')}>${compactClock(tick)}</span>`;
    }
    return html`<div className="app-clock" aria-label=${'Simulated time ' + clockText(tick) + ', sim day ' + simDay(tick) + (paused ? ', paused' : '')}>
      <span className="app-clock-time num">${clockText(tick)}</span>
      <span className="app-clock-sub">
        <span className="num">${'Sim day ' + simDay(tick)}</span>
        ${verifying ? html`<span className="app-chip app-chip--accent num">${'Verifying ' + (verifying.done || 0) + ' / ' + (verifying.total || 0)}</span>`
          : paused && hasEngine() ? html`<span className="app-chip">Paused</span>` : null}
      </span>
    </div>`;
  }

  function SpeedControl(p) {
    var speed = useSpeed();
    var Seg = ui('Segmented');
    var engine = hasEngine();
    return html`<div className="app-speed">
      ${Seg ? html`<${Seg} id=${p.id || 'app-speed'} label="Simulation speed" size="sm" options=${SPEEDS} value=${speed}
        onChange=${setSpeed} disabled=${!engine} />` : null}
      ${speed === 'pause' && engine ? html`<button type="button" id=${(p.id || 'app-speed') + '-step'} className="k-btn k-btn--secondary k-btn--sm" onClick=${stepOnce}>
        <${Icon} name="step" size=${14} /><span className="k-btn-label">Step 1h</span></button>` : null}
    </div>`;
  }

  function PlayPause() {
    var speed = useSpeed();
    var paused = speed === 'pause';
    var IB = ui('IconButton');
    if (!IB || !hasEngine()) return null;
    return html`<${IB} id="app-playpause" icon=${paused ? 'play' : 'pause'} label=${paused ? 'Resume simulation' : 'Pause simulation'}
      onClick=${function () { setSpeed(paused ? '1x' : 'pause'); }} />`;
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
    var open = useSel(selOpenCount) || 0;
    return html`<nav className="app-nav" aria-label="Main">
      <ul>
        ${NAV.map(function (n) {
          var on = n.route === route;
          var built = !!(MC.views && typeof MC.views[n.route] === 'function');
          var badge = n.route === 'agents' && open > 0 ? open : 0;
          return html`<li key=${n.route}>
            <a href=${'#' + n.route} id=${(p.idPrefix || 'app-nav') + '-' + n.route} className=${cx('app-nav-link', on && 'is-on')}
                aria-current=${on ? 'page' : null} title=${n.label}
                onClick=${function (e) { e.preventDefault(); go(n.route); if (p.onNavigate) p.onNavigate(n.route); }}>
              <span className="app-nav-icon" aria-hidden="true"><${Icon} name=${n.icon} size=${18} /></span>
              <span className="app-nav-label">${n.label}</span>
              ${badge ? html`<span className="app-nav-badge num" aria-label=${badge + ' pending approvals'}>${badge}</span>` : null}
              ${!built ? html`<span className="app-nav-soon">Soon</span>` : null}
            </a>
          </li>`;
        })}
      </ul>
    </nav>`;
  }

  function Sidebar() {
    var Badge = ui('SampleDataBadge');
    return html`<aside className="app-sidebar" aria-label="Kestrel">
      <div className="app-sidebar-top"><${Mark} /></div>
      <${NavList} />
      <div className="app-sidebar-foot">
        <div className="app-tenant">
          <span className="app-tenant-name">Fernway Outfitters</span>
          ${Badge ? html`<${Badge} />` : null}
        </div>
        <div className="app-theme"><${ThemeControl} id="app-theme" /></div>
      </div>
    </aside>`;
  }

  /* ---------------- top bar ---------------- */
  function Crumbs() {
    var route = useUi(selRoute);
    var cf = useUi(selCampFocus);
    var campaigns = useSel(selCampaigns);
    var title = TITLES[route] || TITLES.home;
    var leaf = null;
    if (route === 'campaigns' && cf) {
      if (cf.mode === 'detail' && cf.id && campaigns && campaigns.byId && campaigns.byId[cf.id]) leaf = campaigns.byId[cf.id].name;
      else if (cf.mode === 'planner') leaf = 'New campaign plan';
    }
    if (!leaf) return html`<div className="app-title">${title}</div>`;
    return html`<nav className="app-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="#campaigns" onClick=${function (e) { e.preventDefault(); go('campaigns', { mode: 'board' }); }}>Campaigns</a></li>
        <li aria-current="page"><span className="app-title app-title--leaf">${leaf}</span></li>
      </ol>
    </nav>`;
  }

  function ApprovalsButton(p) {
    var open = useSel(selOpenCount) || 0;
    var label = open ? 'Approvals, ' + open + ' waiting' : 'Approvals';
    if (p.compact) {
      var IB = ui('IconButton');
      return IB ? html`<${IB} id="app-approvals-btn" icon="inbox" label=${label} badge=${open}
        onClick=${function () { setUi({ drawer: 'approvals' }); }} />` : null;
    }
    return html`<button type="button" id="app-approvals-btn" className="k-btn k-btn--secondary k-btn--md app-approvals-btn" aria-label=${label}
        onClick=${function () { setUi({ drawer: 'approvals' }); }}>
      <${Icon} name="inbox" size=${16} /><span className="k-btn-label">Approvals</span>
      ${open ? html`<span className="app-count num" aria-hidden="true">${open}</span>` : null}
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
    function restart() {
      setBusy(true);
      var done = function () { setBusy(false); close(); MC.uiStore.clearToasts && MC.uiStore.clearToasts(); notifySpeed(); };
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
          ${confirm && IC ? html`<${IC} id="app-restart-confirm" tone="crit" busy=${busy}
              message="Restart the simulation? This clears every change since Nov 7 · 00:00."
              confirmLabel="Restart" cancelLabel="Keep going" onConfirm=${restart} onCancel=${function () { setConfirm(false); }} />`
            : html`<button type="button" className="app-menu-item" id="app-restart" disabled=${!(MC.engine && MC.engine.restart)}
                onClick=${function () { setConfirm(true); }}><${Icon} name="refresh" size=${16} /><span>Restart simulation${ELL}</span></button>`}
          <button type="button" className="app-menu-item" id="app-audit"
              onClick=${function () { close(); go('agents', { tab: 'audit' }); }}><${Icon} name="shield" size=${16} /><span>Audit & replay</span></button>
          ${dismissed ? html`<button type="button" className="app-menu-item" id="app-sample-note"
              onClick=${function () { close(); setUi({ sampleDismissed: false }); }}><${Icon} name="info" size=${16} /><span>Show the sample-data note</span></button>` : null}
        </div>
      <//>` : null}
    </div>`;
  }

  function Topbar(p) {
    var Pulse = ui('AgentPulse');
    if (p.phone) {
      var IB = ui('IconButton');
      return html`<header className="app-topbar app-topbar--phone">
        <${Mark} compact=${true} />
        <div className="app-topbar-title"><${Crumbs} /></div>
        <${SimClock} compact=${true} />
        <${PlayPause} />
        <${ApprovalsButton} compact=${true} />
        ${IB ? html`<${IB} id="app-menu-btn" icon="menu" label="Menu" onClick=${function () { setUi({ drawer: 'menu' }); }} />` : null}
      </header>`;
    }
    return html`<header className="app-topbar">
      <div className="app-topbar-title"><${Crumbs} /></div>
      <div className="app-topbar-tools">
        <${SimClock} />
        <${SpeedControl} />
        ${Pulse ? html`<span className="app-pulse"><${Pulse} compact=${!!p.narrow} /></span>` : null}
        <${ApprovalsButton} compact=${!!p.narrow} />
        <${OverflowMenu} />
      </div>
    </header>`;
  }

  function SampleStrip() {
    var dismissed = useUi(selSample);
    if (dismissed) return null;
    return html`<div className="app-sample" role="note">
      <${Icon} name="info" size=${16} />
      <p>You're exploring sample data. Fernway Outfitters is fictional; customers, results and agents run on a deterministic simulator.</p>
      <button type="button" id="app-sample-ok" className="k-btn k-btn--secondary k-btn--sm" onClick=${function () { setUi({ sampleDismissed: true }); }}>
        <span className="k-btn-label">Got it</span></button>
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
    var agSt = useState([]), agents = agSt[0], setAgents = agSt[1];
    var rkSt = useState([]), risks = rkSt[0], setRisks = rkSt[1];
    var cfSt = useState(false), confirm = cfSt[0], setConfirm = cfSt[1];
    var msgSt = useState(null), msg = msgSt[0], setMsg = msgSt[1];
    var moreSt = useState(30), limit = moreSt[0], setLimit = moreSt[1];
    var holdSt = useState(false), hold = holdSt[0], setHold = holdSt[1];
    var lists = useMemo(function () { return proposalLists(props); }, [props]);
    var Tabs = ui('Tabs'), Chip = ui('ChipToggle'), PC = ui('ProposalCard'), Empty = ui('EmptyState'), IC = ui('InlineConfirm'), Btn = ui('Button'), NewPill = ui('NewItemsPill');

    var base = lists[tab] || [];
    var agentIds = [];
    base.forEach(function (x) { if (agentIds.indexOf(x.agentId) < 0) agentIds.push(x.agentId); });
    var filtered = base.filter(function (x) {
      return (!agents.length || agents.indexOf(x.agentId) >= 0) && (!risks.length || risks.indexOf(x.risk) >= 0);
    });
    var frozen = MC.hooks.useFrozen ? MC.hooks.useFrozen(filtered, { key: 'id', freeze: hold }) : { items: filtered, pending: 0, reveal: function () {} };
    var shown = frozen.items.slice(0, limit);
    var lowIds = tab === 'needs' ? filtered.filter(function (x) { return x.risk === 'low'; }).map(function (x) { return x.id; }) : [];

    function toggle(list, setList, v) {
      setList(list.indexOf(v) >= 0 ? list.filter(function (y) { return y !== v; }) : list.concat([v]));
    }
    function switchTab(t) { setTab(t); setConfirm(false); setMsg(null); setLimit(30); setAgents([]); setRisks([]); }
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
        ${base.length && Chip ? html`<div className="app-filters" role="group" aria-label="Filter proposals">
          ${agentIds.map(function (a) {
            return html`<${Chip} key=${a} id=${'approvals-agent-' + a} size="sm" label=${agentName(a)} checked=${agents.indexOf(a) >= 0}
              onChange=${function () { toggle(agents, setAgents, a); }} />`;
          })}
          ${RISKS.map(function (r) {
            return html`<${Chip} key=${r.value} id=${'approvals-risk-' + r.value} size="sm" label=${r.label} checked=${risks.indexOf(r.value) >= 0}
              onChange=${function () { toggle(risks, setRisks, r.value); }} />`;
          })}
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
    var Badge = ui('SampleDataBadge');
    var Pulse = ui('AgentPulse');
    function closeMenu() { setUi({ drawer: null }); }
    return html`<div className="app-menu-sheet">
      <${NavList} idPrefix="app-menu-nav" onNavigate=${closeMenu} />
      <section className="app-menu-section" aria-labelledby="app-menu-sim">
        <h3 id="app-menu-sim" className="app-menu-heading">Simulation</h3>
        <${SimClock} />
        <${SpeedControl} id="app-menu-speed" />
        ${Pulse ? html`<${Pulse} onClick=${function () { closeMenu(); go('agents', { tab: 'roster' }); }} />` : null}
      </section>
      <section className="app-menu-section" aria-labelledby="app-menu-theme-h">
        <h3 id="app-menu-theme-h" className="app-menu-heading">Appearance</h3>
        <${ThemeControl} id="app-menu-theme" block=${true} />
      </section>
      <div className="app-tenant">
        <span className="app-tenant-name">Fernway Outfitters</span>
        ${Badge ? html`<${Badge} />` : null}
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
      <p>The rest of Kestrel keeps running, and the simulation and agents are unaffected.</p>
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
    return html`<section className="app-unbuilt">
      <h1 id="page-title" tabIndex="-1" className="app-page-h1">${title}</h1>
      ${Empty ? html`<${Empty} icon="sparkle" title="This area is still being built."
        body="Command Center, Audiences and Analytics are ready to explore while this one is finished." />`
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
    { id: 'profiles', label: 'Generating 6,000 customer profiles' },
    { id: 'history', label: 'Replaying 60 days of campaign history' },
    { id: 'scores', label: 'Scoring propensity, churn and lifetime value' },
    { id: 'agents', label: 'Starting the agents' }
  ];
  function BootCard(p) {
    var idx = -1;
    PHASES.forEach(function (ph, i) { if (ph.id === p.phase) idx = i; });
    if (p.error) {
      return html`<section className="app-bootcard app-bootcard--error" role="alert">
        <h1 id="page-title" tabIndex="-1" className="app-page-h1">Kestrel couldn't start the simulation.</h1>
        <p>${p.error}</p>
        <button type="button" className="k-btn k-btn--primary k-btn--md" id="app-boot-retry" onClick=${p.onRetry}><span className="k-btn-label">Try again</span></button>
      </section>`;
    }
    return html`<section className="app-bootcard" role="status" aria-label="Loading the sample world">
      <p className="app-bootcard-title">Generating the Fernway sample world${ELL}</p>
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
  function startBoot() {
    setBoot({ started: true, error: null, phase: 'profiles' });
    try {
      if (MC.engine && typeof MC.engine.boot === 'function') {
        var r = MC.engine.boot({ seed: MC.SEED, onPhase: function (ph) { setBoot({ phase: typeof ph === 'string' ? ph : (ph && ph.phase) || bootState.phase }); } });
        if (r && typeof r.then === 'function') {
          r.then(function () { setBoot({ phase: 'done' }); notifySpeed(); },
            function (e) { report(e); setBoot({ error: 'Something went wrong while generating the sample world: ' + ((e && e.message) || e) }); });
        } else { setBoot({ phase: 'done' }); notifySpeed(); }
        return;
      }
      if (MC.data && typeof MC.data.generate === 'function') {
        // Engine not available: show a still snapshot of the generated world (no clock, no agents).
        window.setTimeout(function () {
          try { MC.store.init(MC.data.generate(MC.SEED)); setBoot({ phase: 'done' }); }
          catch (e) { report(e); setBoot({ error: 'Something went wrong while generating the sample world: ' + ((e && e.message) || e) }); }
        }, 0);
        return;
      }
      setBoot({ error: 'The simulation engine for this deployment is missing, so there is no sample world to show yet.' });
    } catch (e) {
      report(e);
      setBoot({ error: 'Something went wrong while generating the sample world: ' + ((e && e.message) || e) });
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

  /* ---------------- toasts from agent activity (one per tick, coalesced) ---------------- */
  function viewFor(item) {
    var e = item.entity;
    if (e && e.kind === 'campaign') return { route: 'campaigns', focus: { mode: 'detail', id: e.id, tab: 'overview' } };
    if (e && e.kind === 'variant') return { route: 'content', focus: { variantId: e.id } };
    if (e && e.kind === 'segment') return { route: 'audiences', focus: { tab: 'segments', segmentId: e.id } };
    return { route: 'agents', focus: { tab: 'activity', agentId: item.agentId || 'optimizer' } };
  }
  function watchToasts() {
    var lastTick = null, seenTop = null;
    function topId(w) { return w.feed && w.feed.length ? w.feed[0].id : null; }
    MC.store.subscribe(function () {
      var w = MC.store.getState();
      if (!w || !w.meta) return;
      var t = w.meta.tick;
      if (lastTick === null || t < lastTick) { lastTick = t; seenTop = topId(w); return; }   // first world or restart
      if (t === lastTick) return;
      lastTick = t;
      var feed = w.feed || [];
      var fresh = [];
      for (var i = 0; i < feed.length && i < 200; i++) {
        if (feed[i].id === seenTop) break;
        fresh.push(feed[i]);
      }
      seenTop = topId(w);
      var notify = MC.uiStore.getState().notify || {};
      var applied = [], proposed = [];
      fresh.forEach(function (it) {
        var lvl = notify[it.agentId] || 'changes';
        if (lvl === 'silent') return;
        if (it.kind === 'agent-applied') applied.push(it);
        else if (it.kind === 'agent-proposed' && lvl === 'all') proposed.push(it);
      });
      if (!applied.length && !proposed.length) return;
      var newPending = 0;
      if (proposed.length && w.proposals && w.proposals.open) {
        var ok = {};
        proposed.forEach(function (it) { ok[it.agentId] = true; });
        w.proposals.open.forEach(function (id) { var x = w.proposals.byId[id]; if (x && ok[x.agentId] && x.tick >= t - 1) newPending++; });
      }
      newPending = Math.max(newPending, proposed.length);
      var toast;
      if (applied.length === 1 && !proposed.length) {
        var it = applied[0], v = viewFor(it), actions = [];
        if (it.proposalId) actions.push({ label: 'Undo', kind: 'undo', proposalId: it.proposalId });
        actions.push({ label: 'View', kind: 'view', route: v.route, focus: v.focus });
        toast = { text: it.text, tone: 'agent', actions: actions };
      } else if (applied.length && proposed.length) {
        toast = { text: 'Agents made ' + applied.length + ' change' + (applied.length === 1 ? '' : 's') + ' and ' + newPending + ' new item' + (newPending === 1 ? ' needs' : 's need') + ' you',
          tone: 'agent', actions: [{ label: 'Review', kind: 'review' }] };
      } else if (applied.length) {
        toast = { text: 'Agents made ' + applied.length + ' changes', tone: 'agent', actions: [{ label: 'Review', kind: 'review' }] };
      } else {
        toast = { text: newPending + ' new item' + (newPending === 1 ? ' needs' : 's need') + ' you', tone: 'agent', actions: [{ label: 'Review', kind: 'review' }] };
      }
      MC.uiStore.addToast(toast);
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
