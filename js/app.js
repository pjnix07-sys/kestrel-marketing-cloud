/* Marketing Cloud - application shell (docs/DESIGN-DIRECTION.md "Navigation"): one top bar (mark, mission switcher,
   New goal, Asks, Team, Artifacts, Connect Claude, overflow), the Asks drawer (mission asks first, then proposals),
   a New goal drawer, theme, batched autopilot toasts, bare-hash router (#missions, #missions/<id>, #team and the
   artifact routes), error boundaries, boot. Sample tenant: Fernway Outfitters (fictional). No clock, pace or
   playback controls anywhere: the product is live software reacting to real state. */
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
    bootMessage("Marketing Cloud couldn't start.", 'A core file failed to load. Reload the page; if it keeps happening, the deployment is incomplete.');
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

  /* ---------------- on-demand views: a view's script and stylesheet load the first time its route opens ---------------- */
  var VQ = '?v=' + encodeURIComponent(MC.BUILD || '0');
  var LAZY = {
    missions: { js: 'mission', css: 'mission' }, campaigns: { js: 'campaigns', css: 'campaigns' }, content: { js: 'content', css: 'content' },
    audiences: { js: 'audiences', css: 'audiences' }, analytics: { js: 'analytics', css: 'analytics' },
    agents: { js: 'console', css: 'console' }, connect: { js: 'connect' }, tour: { js: 'tour' }
  };
  var lazyState = {}, lazySubs = [], lazyVer = 0;
  function lazyNotify() { lazyVer++; lazySubs.slice().forEach(function (fn) { try { fn(lazyVer); } catch (e) { report(e); } }); }
  function lazyReady(key) {
    if (key === 'connect') return !!MC.connect;
    if (key === 'tour') return !!MC.tour;
    return !!(MC.views && typeof MC.views[key] === 'function');
  }
  function addTag(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs).forEach(function (k) { if (attrs[k] !== undefined) el[k] = attrs[k]; });
    document.head.appendChild(el);
    return el;
  }
  function loadLazy(key) {
    var def = LAZY[key];
    if (!def || lazyReady(key)) return Promise.resolve();
    var st = lazyState[key];
    if (st && st.promise && !st.error) return st.promise;
    st = lazyState[key] = { error: false };
    var parts = [new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'js/views/' + def.js + '.js' + VQ;
      sc.onload = function () { resolve(); };
      sc.onerror = function () { sc.remove(); reject(new Error('Could not load ' + key)); };
      document.body.appendChild(sc);
    })];
    if (def.css && !document.querySelector('link[data-lazy="' + key + '"]')) {
      parts.push(new Promise(function (resolve) {
        addTag('link', { rel: 'stylesheet', href: 'css/views/' + def.css + '.css' + VQ, onload: resolve, onerror: resolve }).setAttribute('data-lazy', key);
      }));
    }
    st.promise = Promise.all(parts).then(function () { lazyNotify(); }, function (e) { st.error = true; lazyNotify(); throw e; });
    st.promise.catch(function () { /* reported through lazyStatus */ });
    return st.promise;
  }
  function lazyStatus(key) {
    if (lazyReady(key)) return 'ready';
    if (!LAZY[key]) return 'missing';
    return lazyState[key] && lazyState[key].error ? 'error' : 'loading';
  }
  function useLazyVersion() {
    var st = useState(lazyVer);
    useEffect(function () { lazySubs.push(st[1]); st[1](lazyVer); return function () { var i = lazySubs.indexOf(st[1]); if (i >= 0) lazySubs.splice(i, 1); }; }, []);
    return st[0];
  }
  // After boot, fetch the other views' files into the HTTP cache when the browser is idle (no parsing, no execution).
  function prefetchViews() {
    var keys = ['missions', 'campaigns', 'content', 'audiences', 'analytics', 'agents'], i = 0;
    function one() {
      if (i >= keys.length) return;
      var def = LAZY[keys[i++]];
      try {
        addTag('link', { rel: 'prefetch', as: 'script', href: 'js/views/' + def.js + '.js' + VQ });
        addTag('link', { rel: 'prefetch', as: 'style', href: 'css/views/' + def.css + '.css' + VQ });
      } catch (e) { /* prefetch is an optimisation only */ }
      idle(one);
    }
    idle(one);
  }
  function idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 4000 });
    else window.setTimeout(fn, 1200);
  }
  // Input modality: lets the page heading take focus after navigation without a ring for pointer users.
  (function trackInput() {
    var d = document.documentElement;
    document.addEventListener('keydown', function (e) { if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') d.setAttribute('data-input', 'keyboard'); }, true);
    document.addEventListener('pointerdown', function () { d.setAttribute('data-input', 'pointer'); }, true);
  })();

  var TITLES = { missions: 'Goals', home: 'Home', approvals: 'Approvals', agents: 'Agents', campaigns: 'Campaigns', content: 'Content', audiences: 'Audiences', analytics: 'Results' };
  function openGoal() { setUi({ drawer: 'goal' }); }
  var THEMES = [
    { value: 'system', label: 'System', icon: 'monitor', ariaLabel: 'System theme' },
    { value: 'light', label: 'Light', icon: 'sun', ariaLabel: 'Light theme' },
    { value: 'dark', label: 'Dark', icon: 'moon', ariaLabel: 'Dark theme' }
  ];

  /* ---------------- selectors (module-level, stable) ---------------- */
  function selReady(w) { return !!w; }
  function selProposals(w) { return w ? w.proposals : null; }
  function selCampaigns(w) { return w ? w.campaigns : null; }
  function selRoute(s) { return s.route; }
  function selDrawer(s) { return s.drawer; }
  function selTheme(s) { return s.theme; }
  function selMissions(w) { return w ? w.missions : null; }
  function selMissionFocus(s) { return s.missionFocus || null; }
  // One Asks count everywhere: MC.metrics.asks (docs/CONSISTENCY.md section 1).
  function selAskCount(w) {
    if (!w) return 0;
    try {
      if (MC.metrics && typeof MC.metrics.asks === 'function') {
        var r = MC.metrics.asks(w);
        if (fin(r)) return r;
        if (Array.isArray(r)) return r.length;
        if (r && fin(r.count)) return r.count;
        if (r && fin(r.total)) return r.total;
        if (r && fin(r.n)) return r.n;
      }
    } catch (e) { report(e); }
    return 0;
  }
  function isLive(m) { return !!m && m.status !== 'done' && m.status !== 'stopped'; }
  function liveMissions(slice) {
    return slice && slice.order ? slice.order.map(function (id) { return slice.byId[id]; }).filter(isLive) : [];
  }
  function missionGoal(m) { return m ? (m.goalText || m.title || 'Untitled goal') : ''; }

  function report(e) { if (window.console && console.error) console.error(e); }

  /* ---------------- team personas: "Viewing as" (a synthetic team; persisted in this browser) ---------------- */
  var PERSONA_KEY = 'mc.persona.v1';
  (function initPersona() {
    var id = 'admin';
    try { var raw = window.localStorage && window.localStorage.getItem(PERSONA_KEY); if (raw && MC.catalog.persona(raw)) id = raw; } catch (e) { /* storage unavailable */ }
    MC.uiStore.set({ persona: id, decisionNotes: {} });
  })();
  function selPersona(s) { return s.persona || 'admin'; }
  function setPersona(id) {
    if (!MC.catalog.persona(id)) return;
    try { if (window.localStorage) window.localStorage.setItem(PERSONA_KEY, id); } catch (e) { /* ignore */ }
    setUi({ persona: id });
  }
  function PersonaSwitch(p) {
    var who = useUi(selPersona);
    var cur = MC.catalog.persona(who);
    return html`<div className="app-persona">
      <label className="app-persona-label" htmlFor=${p.id || 'app-persona'}>Viewing as</label>
      <span className="k-select-wrap k-select-wrap--sm"><select id=${p.id || 'app-persona'} className="k-select" value=${who}
          onChange=${function (ev) { setPersona(ev.target.value); }}>
        ${MC.catalog.PERSONAS.map(function (x) { return html`<option key=${x.id} value=${x.id}>${x.name + ', ' + x.role}</option>`; })}
      </select></span>
      ${cur && cur.perms.indexOf('approve') < 0 ? html`<span className="app-persona-note">Read only: can't approve or schedule.</span>` : null}
      <span className="app-persona-note app-persona-demo">Demo: switch roles to see approvals and sign-off rules.</span>
    </div>`;
  }
  function canDo(perm) { return MC.catalog.can(MC.uiStore.getState().persona || 'admin', perm); }
  function DecisionNote(p) {
    var notes = useUi(function (s) { return s.decisionNotes; }) || {};
    var who = useUi(selPersona);
    if (!MC.catalog.can(who, 'approve')) return html`<p className="app-decide-ro">Your role can read this but not approve or dismiss it.</p>`;
    return html`<div className="app-decide">
      <label className="k-sr" htmlFor=${'note-' + p.id}>Note on your decision (optional)</label>
      <input id=${'note-' + p.id} className="k-input app-decide-input" type="text" maxLength="240" placeholder="Add a note for the record (optional)"
        value=${notes[p.id] || ''} onChange=${function (ev) { var v = ev.target.value, n = Object.assign({}, MC.uiStore.getState().decisionNotes); n[p.id] = v; setUi({ decisionNotes: n }); }} />
      ${p.risk === 'high' ? html`<p className="app-decide-hint">${(p.signoffs && p.signoffs.length)
        ? 'Signed off by ' + p.signoffs.map(function (x) { return MC.catalog.personaName(x.by); }).join(', ') + '. Needs a second approver.'
        : 'High risk: needs two different approvers.'}</p>` : null}
    </div>`;
  }
  function DecisionMeta(p) {
    var now = useSel(function (w) { return w.meta.tick; });
    var x = p.p;
    var T = MC.time;
    var when = (x.decidedTick !== undefined && T && T.relative) ? T.relative(x.decidedTick, now) : '';
    var line = null;
    if (x.status === 'applied') line = 'Approved by ' + (x.decidedBy ? MC.catalog.personaName(x.decidedBy) : 'a colleague');
    else if (x.status === 'rejected') line = 'Dismissed by ' + (x.decidedBy ? MC.catalog.personaName(x.decidedBy) : 'a colleague');
    else if (x.status === 'expired') line = 'Expired unreviewed after 48 hours';
    if (!line) return null;
    var why = x.decisionNote || (x.status === 'rejected' && x.dismissReason ? ({ 'not-now': 'Not now', wrong: 'Not a good idea', other: 'Other' })[x.dismissReason] : null);
    return html`<p className="app-decided">${line}${when ? ' ' + DOT + ' ' + when : ''}${why ? html`<span className="app-decided-why">${' ' + DOT + ' ' + why}</span>` : null}</p>`;
  }
  MC.ui = MC.ui || {};
  MC.ui.PersonaSwitch = PersonaSwitch; MC.ui.DecisionNote = DecisionNote; MC.ui.DecisionMeta = DecisionMeta;

  function ThemeControl(p) {
    var theme = useUi(selTheme) || 'system';
    var Seg = ui('Segmented');
    if (!Seg) return null;
    var opts = THEMES.map(function (o) { return Object.assign({}, o, { iconOnly: !p.block, title: o.label }); });
    return html`<${Seg} id=${p.id || 'app-theme'} label="Theme" size="sm" block=${!!p.block} options=${opts} value=${theme}
      onChange=${function (v) { setUi({ theme: v }); }} />`;
  }

  /* ---------------- router: #missions, #missions/<id>, #team and the artifact routes ----------------
     The store owns the route state and the plain hashes. This layer adds the mission hashes without touching it:
     programmatic navigation sets state and uses pushState (no hashchange round trip), and back/forward or a typed
     hash is reconciled by applyHash(). #home (or no hash) is Home; #approvals is the Approvals page. */
  var storeGo = MC.nav.go;
  if (MC.nav.ROUTES) ['missions', 'approvals'].forEach(function (r) { if (MC.nav.ROUTES.indexOf(r) < 0) MC.nav.ROUTES.push(r); });
  function navTo(route, focusPatch, hash) {
    MC.uiStore.set(function (s) {
      var out = { route: route };
      if (focusPatch && typeof focusPatch === 'object') {
        var f = Object.assign({}, s.focus);
        f[route] = Object.assign({}, s.focus[route], focusPatch);
        out.focus = f;
      }
      return out;
    });
    try { if (window.location.hash !== '#' + hash) window.history.pushState(null, '', '#' + hash); } catch (e) { /* no history */ }
  }
  MC.nav.go = function (route, focus) {
    if (route === 'home') { setUi({ missionFocus: null }); navTo('home', null, 'home'); return; }
    if (route === 'approvals') { setUi({ missionFocus: null, drawer: null }); navTo('approvals', null, 'approvals'); return; }
    if (route === 'missions') {
      var id = typeof focus === 'string' ? focus : (focus && typeof focus === 'object' && focus.id) || null;
      setUi({ missionFocus: id });
      navTo('missions', null, id ? 'missions/' + encodeURIComponent(id) : 'missions');
      return;
    }
    if (route === 'team' || route === 'agents') { navTo('agents', focus, 'team'); return; }
    storeGo(route, focus);
  };
  function applyHash() {
    var h = '';
    try { h = String(window.location.hash || '').replace(/^#/, ''); } catch (e) { h = ''; }
    var parts = h.split('/'), r = parts[0];
    if (!r || r === 'home') { MC.uiStore.set({ route: 'home', missionFocus: null }); return; }
    if (r === 'approvals') { MC.uiStore.set({ route: 'approvals', missionFocus: null }); return; }
    if (r === 'missions') {
      var id = null;
      try { id = parts[1] ? decodeURIComponent(parts[1]) : null; } catch (e) { id = null; }
      MC.uiStore.set({ route: 'missions', missionFocus: id });
      try { if (parts[0] !== 'missions') window.history.replaceState(null, '', '#missions' + (id ? '/' + encodeURIComponent(id) : '')); } catch (e) { /* ignore */ }
    } else if (r === 'team') {
      MC.uiStore.set({ route: 'agents', missionFocus: null });
    }
  }
  applyHash();
  window.addEventListener('hashchange', applyHash);   // registered after the store's own handler, so it has the last word

  /* ---------------- Connect Claude (phone menu sheet) ---------------- */
  function ConnectButton() {
    useLazyVersion();
    var C = MC.connect && MC.connect.TopButton;
    if (C) return html`<${C} />`;
    return html`<button type="button" id="app-connect-btn" className="cx-top" aria-label="Connect Claude"
        onClick=${function () { setUi({ drawer: 'connect' }); loadLazy('connect'); }}><span className="cx-top-label">Connect Claude</span></button>`;
  }


  /* ---------------- side rail (docs/PRODUCT.md §2): icons only; the name shows on hover and keyboard focus ---------------- */
  var NAV = [
    { route: 'home', label: 'Home', icon: 'home' },
    { route: 'missions', label: 'Goals', icon: 'goals' },
    { route: 'approvals', label: 'Approvals', icon: 'inbox', count: true },
    { route: 'campaigns', label: 'Campaigns', icon: 'campaigns' },
    { route: 'audiences', label: 'Audiences', icon: 'audiences' },
    { route: 'content', label: 'Content', icon: 'content' },
    { route: 'analytics', label: 'Results', icon: 'analytics' },
    { route: 'agents', label: 'Agents', icon: 'agents' }
  ];
  var DETAILS = [{ value: 'simple', label: 'Simple' }, { value: 'detailed', label: 'Detailed' }];
  function selDetailLevel(s) { return s.detail || 'simple'; }

  function RailTip(p) { return html`<span className="rail-tip" aria-hidden="true">${p.children}</span>`; }

  function RailLink(p) {
    var route = useUi(selRoute);
    var n = useSel(selAskCount) || 0;
    var on = route === p.item.route || (p.item.route === 'home' && route === 'home');
    var count = p.item.count ? n : 0;
    var label = p.item.label + (count ? ', ' + count + ' waiting' : '');
    return html`<a href=${'#' + (p.item.route === 'agents' ? 'team' : p.item.route)} id=${'rail-' + p.item.route}
        className=${cx('rail-item', on && 'is-on')} aria-label=${label} aria-current=${on ? 'page' : null}
        onClick=${function (e) { e.preventDefault(); go(p.item.route); }}>
      <${Icon} name=${p.item.icon} size=${20} />
      ${count ? html`<span className="rail-badge num" aria-hidden="true">${count > 99 ? '99+' : count}</span>` : null}
      <${RailTip}>${p.item.label}${count ? ' (' + count + ')' : ''}<//>
    </a>`;
  }

  function RailButton(p) {
    return html`<button type="button" ref=${p.btnRef} id=${p.id} className=${cx('rail-item', p.on && 'is-on', p.className)} aria-label=${p.label}
        aria-haspopup=${p.popup ? 'dialog' : null} aria-expanded=${p.popup ? (p.on ? 'true' : 'false') : null} onClick=${p.onClick}>
      <${Icon} name=${p.icon} size=${20} />${p.dot ? html`<span className=${cx('rail-dot', p.dot)} aria-hidden="true"></span>` : null}
      <${RailTip}>${p.tip || p.label}<//>
    </button>`;
  }

  function DetailControl(p) {
    var level = useUi(selDetailLevel);
    var Seg = ui('Segmented');
    if (!Seg) return null;
    return html`<${Seg} id=${p.id || 'app-detail'} label="Detail level" size="sm" block=${!!p.block} options=${DETAILS} value=${level}
      onChange=${function (v) { setUi({ detail: v }); }} />`;
  }

  function SettingsContent(p) {
    return html`<div className="app-menu app-settings">
      <h2 className="app-menu-heading">Settings</h2>
      <div className="app-menu-row"><span className="app-menu-row-label">Theme</span><${ThemeControl} id=${(p.idp || 'app-set') + '-theme'} /></div>
      <div className="app-menu-row app-menu-row--stack"><span className="app-menu-row-label">Detail level</span><${DetailControl} id=${(p.idp || 'app-set') + '-detail'} />
        <span className="app-menu-note">Simple keeps advanced figures and controls one click away. Detailed opens them everywhere.</span></div>
      <div className="app-menu-row app-menu-persona"><${PersonaSwitch} id=${(p.idp || 'app-set') + '-persona'} /></div>
      <div className="app-menu-row app-menu-row--stack">
        <span className="app-menu-row-label">Workspace</span>
        <span className="app-tenant"><span className="app-tenant-name">Fernway Outfitters</span> <span className="app-tenant-note">Sample workspace</span></span>
      </div>
      <${ResetItem} id=${(p.idp || 'app') + '-restart'} onDone=${p.onDone} />
    </div>`;
  }

  function HelpContent(p) {
    return html`<div className="app-menu app-help">
      <h2 className="app-menu-heading">Help</h2>
      <button type="button" className="app-menu-item" id=${(p.idp || 'app') + '-take-tour'} onClick=${function () { p.onDone(); startTour(); }}><span>Getting started</span></button>
      <button type="button" className="app-menu-item" onClick=${function () { p.onDone(); openGoal(); }}><span>Set a new goal</span></button>
      <dl className="app-keys">
        <div><dt><kbd className="app-kbd">/</kbd> or <kbd className="app-kbd">Ctrl K</kbd></dt><dd>Search everything</dd></div>
        <div><dt><kbd className="app-kbd">Ctrl Enter</kbd></dt><dd>Start a goal from the goal box</dd></div>
        <div><dt><kbd className="app-kbd">Esc</kbd></dt><dd>Close a panel</dd></div>
      </dl>
    </div>`;
  }

  function RailPop(p) {
    var anchor = useRef(null);
    var st = useState(false), open = st[0], setOpen = st[1];
    var Pop = ui('Popover');
    function close() { setOpen(false); }
    return html`<div className="rail-pop">
      <${RailButton} btnRef=${anchor} id=${p.id} icon=${p.icon} label=${p.label} popup=${true} on=${open} onClick=${function () { setOpen(!open); }} />
      ${Pop ? html`<${Pop} anchorRef=${anchor} open=${open} onClose=${close} label=${p.label} placement="right-end" width=${p.width || 320} id=${p.id + '-menu'}>
        ${p.render(close)}
      <//>` : null}
    </div>`;
  }

  function ClaudeRailButton() {
    var a = MC.ai;
    var st = useState(function () { return a && a.getState ? a.getState() : null; }), g = st[0] || {};
    useEffect(function () {
      if (!a || typeof a.subscribe !== 'function') return undefined;
      var un = a.subscribe(function (x) { st[1](x || (a.getState && a.getState()) || null); });
      return function () { if (typeof un === 'function') un(); };
    }, []);
    var on = g.state === 'on' || g.state === 'expiring', wait = g.state === 'connecting' || g.state === 'expired' || g.state === 'expiring';
    return html`<${RailButton} id="app-connect-btn" icon="plug" label=${on ? 'Claude, connected. Open connection settings' : 'Connect Claude'}
      tip=${on ? 'Claude connected' : 'Connect Claude'} dot=${wait ? 'is-wait' : (on ? 'is-on' : null)}
      onClick=${function () { setUi({ drawer: 'connect' }); loadLazy('connect'); }} />`;
  }

  function Rail() {
    return html`<nav className="rail" aria-label="Main">
      <a className="rail-mark" href="#home" aria-label="Marketing Cloud, Home" onClick=${function (e) { e.preventDefault(); go('home'); }}>
        <svg viewBox="0 0 64 64" width="26" height="26" fill="none" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="5" strokeLinecap="round">
            <path d="M6 12c22 0 26 20 42 20" /><path d="M6 25c18 0 24 7 42 7" /><path d="M6 39c18 0 24-7 42-7" /><path d="M6 52c22 0 26-20 42-20" />
          </g>
          <circle className="app-mark-node" cx="52" cy="32" r="7" />
        </svg>
        <${RailTip}>Marketing Cloud<//>
      </a>
      <${RailButton} id="app-new-goal" icon="plus" label="New goal" className="rail-new" onClick=${openGoal} />
      <div className="rail-group">${NAV.map(function (it) { return html`<${RailLink} key=${it.route} item=${it} />`; })}</div>
      <div className="rail-group rail-foot">
        <${RailButton} id="app-search-btn" icon="search" label="Search" tip="Search ( / )" onClick=${openSearch} />
        <${RailPop} id="app-help" icon="help" label="Help" width=${300} render=${function (close) { return html`<${HelpContent} onDone=${close} />`; }} />
        <${ClaudeRailButton} />
        <${RailPop} id="app-more" icon="settings" label="Settings" width=${340} render=${function (close) { return html`<${SettingsContent} idp="app-more" onDone=${close} />`; }} />
      </div>
    </nav>`;
  }

  var BOTTOM = ['home', 'missions', 'approvals', 'analytics'];
  function BottomBar() {
    var route = useUi(selRoute), drawer = useUi(selDrawer);
    var n = useSel(selAskCount) || 0;
    return html`<nav className="bbar" aria-label="Main">
      ${NAV.filter(function (it) { return BOTTOM.indexOf(it.route) >= 0; }).map(function (it) {
        var on = route === it.route && drawer !== 'menu';
        var count = it.count ? n : 0;
        return html`<a key=${it.route} href=${'#' + it.route} id=${'bbar-' + it.route} className=${cx('bbar-item', on && 'is-on')} aria-current=${on ? 'page' : null}
            aria-label=${it.label + (count ? ', ' + count + ' waiting' : '')} onClick=${function (e) { e.preventDefault(); go(it.route); }}>
          <${Icon} name=${it.icon} size=${20} />${count ? html`<span className="rail-badge num" aria-hidden="true">${count > 99 ? '99+' : count}</span>` : null}
          <span className="bbar-label" aria-hidden="true">${it.label}</span></a>`;
      })}
      <button type="button" id="app-menu-btn" className=${cx('bbar-item', drawer === 'menu' && 'is-on')} aria-label="More" onClick=${function () { setUi({ drawer: 'menu' }); }}>
        <${Icon} name="menu" size=${20} /><span className="bbar-label" aria-hidden="true">More</span></button>
    </nav>`;
  }

  function ApprovalsPage() {
    var n = useSel(selAskCount) || 0;
    return html`<section className="app-page app-approvals-page">
      <header className="app-page-head">
        <h1 id="page-title" tabIndex="-1" className="app-page-title">Approvals</h1>
        <p className="app-page-lede">${n ? n + (n === 1 ? ' decision is' : ' decisions are') + ' waiting for you. Agents hold that work until you answer; everything else keeps running.'
          : 'Nothing is waiting for you. When an agent needs a decision, it shows up here.'}</p>
      </header>
      <${AsksPanel} />
    </section>`;
  }

  function ResetItem(p) {
    var cf = useState(false), confirm = cf[0], setConfirm = cf[1];
    var bs = useState(false), busy = bs[0], setBusy = bs[1];
    var IC = ui('InlineConfirm');
    function restart() {
      setBusy(true);
      var done = function () { setBusy(false); p.onDone(); if (MC.uiStore.clearToasts) MC.uiStore.clearToasts(); };
      try {
        var r = MC.engine && typeof MC.engine.restart === 'function' ? MC.engine.restart(MC.SEED) : null;
        if (r && typeof r.then === 'function') r.then(done, function (e) { report(e); done(); }); else done();
      } catch (e) { report(e); done(); }
    }
    if (confirm && IC) {
      return html`<${IC} id="app-restart-confirm" tone="crit" busy=${busy}
        message="Reset the sample data? This clears every change you and the agents have made."
        confirmLabel="Reset" cancelLabel="Cancel" onConfirm=${restart} onCancel=${function () { setConfirm(false); }} />`;
    }
    return html`<button type="button" className="app-menu-item" id=${p.id || 'app-restart'} disabled=${!(MC.engine && MC.engine.restart)}
        onClick=${function () { setConfirm(true); }}><span>Reset sample data${ELL}</span></button>`;
  }




  /* ---------------- approvals drawer ---------------- */
  var RISKS = [{ value: 'low', label: 'Low risk' }, { value: 'medium', label: 'Medium risk' }, { value: 'high', label: 'High risk' }];
  var HISTORY_STATUSES = { applied: 1, rejected: 1, expired: 1, superseded: 1, undone: 1, stale: 1 };
  var HISTORY_FILTERS = [{ value: '', label: 'All decisions' }, { value: 'applied', label: 'Approved' }, { value: 'rejected', label: 'Dismissed' },
    { value: 'expired', label: 'Expired unreviewed' }, { value: 'undone', label: 'Undone' }];
  var EMPTY_TEXT = {
    needs: { title: 'Nothing needs you right now.', body: 'Agents on Suggest will queue changes here.' },
    applied: { title: 'No agent changes yet.', body: 'Agents on Autopilot apply changes that pass every guardrail. They show up here so you can review or undo them.' },
    history: { title: 'No decisions yet.', body: 'Proposals you approve or dismiss, and ones that expire or stop applying, are kept here.' }
  };

  function proposalLists(props) {
    var out = { needs: [], applied: [], history: [] };
    if (!props || !props.byId) return out;
    (props.open || []).forEach(function (id) { var x = props.byId[id]; if (x && x.status === 'pending' && !x.supersededBy) out.needs.push(x); });
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

  function ApprovalsPanel(pp) {
    var props = useSel(selProposals);
    var hideIds = (pp && pp.hideIds) || null;
    var tabSt = useState('needs'), tab = tabSt[0], setTab = tabSt[1];
    var agSt = useState(''), agentF = agSt[0], setAgentF = agSt[1];
    var rkSt = useState(''), riskF = rkSt[0], setRiskF = rkSt[1];
    var hsSt = useState(''), histF = hsSt[0], setHistF = hsSt[1];
    var who = useUi(selPersona);
    var canApprove = MC.catalog.can(who, 'approve');
    var cfSt = useState(false), confirm = cfSt[0], setConfirm = cfSt[1];
    var msgSt = useState(null), msg = msgSt[0], setMsg = msgSt[1];
    var moreSt = useState(30), limit = moreSt[0], setLimit = moreSt[1];
    var holdSt = useState(false), hold = holdSt[0], setHold = holdSt[1];
    var lists = useMemo(function () {
      var l = proposalLists(props);
      if (hideIds) l.needs = l.needs.filter(function (x) { return !hideIds[x.id]; });
      return l;
    }, [props, hideIds]);
    var Tabs = ui('Tabs'), PC = ui('ProposalCard'), Empty = ui('EmptyState'), IC = ui('InlineConfirm'), Btn = ui('Button'), NewPill = ui('NewItemsPill');

    var base = lists[tab] || [];
    var agentIds = [];
    base.forEach(function (x) { if (agentIds.indexOf(x.agentId) < 0) agentIds.push(x.agentId); });
    var filtered = base.filter(function (x) {
      return (!agentF || x.agentId === agentF) && (!riskF || x.risk === riskF) && (tab !== 'history' || !histF || x.status === histF);
    });
    var frozen = MC.hooks.useFrozen ? MC.hooks.useFrozen(filtered, { key: 'id', freeze: hold }) : { items: filtered, pending: 0, reveal: function () {} };
    var shown = frozen.items.slice(0, limit);
    var lowIds = tab === 'needs' && canApprove ? filtered.filter(function (x) { return x.risk === 'low'; }).map(function (x) { return x.id; }) : [];

    function switchTab(t) { setHistF(''); setTab(t); setConfirm(false); setMsg(null); setLimit(30); setAgentF(''); setRiskF(''); }
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
        ${tab === 'history' && base.length ? html`<div className="app-filters" role="group" aria-label="Filter decisions">
          <label className="k-sr" htmlFor="approvals-status">Decision</label>
          <span className="k-select-wrap k-select-wrap--sm"><select id="approvals-status" className="k-select" value=${histF}
              onChange=${function (ev) { setHistF(ev.target.value); }}>
            ${HISTORY_FILTERS.map(function (f) { return html`<option key=${f.value} value=${f.value}>${f.label}</option>`; })}
          </select></span>
        </div>` : null}
        ${base.length > 1 && tab !== 'history' ? html`<div className="app-filters" role="group" aria-label="Filter proposals">
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
            return html`<li key=${x.id}>
              ${tab === 'needs' ? html`<${DecisionNote} id=${x.id} risk=${x.risk} signoffs=${x.signoffs} />` : null}
              ${PC ? html`<${PC} id=${x.id} showTarget=${true} />` : html`<${ProposalFallback} p=${x} />`}
              ${tab === 'history' ? html`<${DecisionMeta} p=${x} />` : null}</li>`;
          })}
        </ul>` : (Empty ? html`<${Empty} icon=${tab === 'needs' ? 'check-circle' : 'inbox'}
            title=${base.length ? 'No proposals match these filters.' : e.title} body=${base.length ? 'Clear a filter to see more.' : e.body} />` : null)}
        ${frozen.items.length > limit && Btn ? html`<div className="app-more-row"><${Btn} kind="ghost" size="sm" id="approvals-more"
            onClick=${function () { setLimit(limit + 30); }}>${'Show more (' + (frozen.items.length - limit) + ')'}<//></div>` : null}
      </div>
    </div>`;
  }

  /* ---------------- asks drawer: mission asks first (answer in place), then agent proposals ---------------- */
  function leadName(id) { return id === 'lead' ? 'Lead' : agentName(id); }
  function nfmt(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v).toLocaleString('en-US') : String(v); }
  function AskCard(p) {
    var m = p.m, a = p.a;
    var ms = useState(null), msg = ms[0], setMsg = ms[1];
    var who = useUi(selPersona);
    var can = MC.catalog.can(who, 'approve');
    function answer(o) {
      var r = null;
      try { r = MC.missions && MC.missions.answer ? MC.missions.answer(m.id, a.id, o) : null; } catch (e) { report(e); }
      if (!r) setMsg("Couldn't send that answer.");
      else if (r.ok === false) setMsg(r.error || "Couldn't send that answer.");
    }
    var imp = a.impact || {};
    return html`<article className="app-ask" aria-label=${'Ask from ' + leadName(a.agentId)}>
      <p className="app-ask-from">${leadName(a.agentId)}<span className="app-ask-sep"> ${DOT} </span>${missionGoal(m)}</p>
      <h3 className="app-ask-q">${a.question}</h3>
      ${a.why ? html`<p className="app-ask-why">${a.why}</p>` : null}
      ${(imp.lo || imp.hi) ? html`<p className="app-ask-impact">Impact <b>${nfmt(imp.lo) + ' to ' + nfmt(imp.hi)}</b>${imp.metric ? ' ' + imp.metric : ''}</p>` : null}
      <div className="app-ask-opts" role="group" aria-label="Your answer">
        ${(a.options || []).map(function (o) {
          var def = o === a.default;
          return html`<button key=${o} type="button" className=${cx('app-ask-btn', def && 'is-default')} disabled=${!can} onClick=${function () { answer(o); }}>${o}${def ? html`<span className="app-ask-def"> (default)</span>` : null}</button>`;
        })}
      </div>
      ${can ? null : html`<p className="app-ask-note">Your role can read this but not answer it.</p>`}
      ${msg ? html`<p className="app-ask-note" role="alert">${msg}</p>` : null}
      <button type="button" className="app-ask-open" onClick=${function () { setUi({ drawer: null }); go('missions', m.id); }}>Open goal</button>
    </article>`;
  }
  // The mission a proposal belongs to: its own missionId, else the mission that made the campaign or audience it targets.
  function missionOfProposal(w, x) {
    var X = MC.xref, t = x.target || {}, ms;
    if (x.missionId && w.missions && w.missions.byId[x.missionId]) return w.missions.byId[x.missionId];
    if (!X || !t.kind || !t.id) return null;
    ms = X.missionsOf(w, t.kind, t.id).filter(isLive);
    return ms[0] || null;
  }
  function AsksPanel() {
    var slice = useSel(selMissions);
    var props = useSel(selProposals);
    var w = MC.store.getState();
    var groups = useMemo(function () {
      var out = [], byM = {}, loose = {};
      liveMissions(slice).forEach(function (m) {
        var g = { m: m, asks: [], props: [] };
        (m.asks || []).forEach(function (a) { if (a.status === 'open') g.asks.push(a); });
        byM[m.id] = g; out.push(g);
      });
      ((props && props.open) || []).forEach(function (id) {
        var x = props.byId[id];
        if (!x || x.status !== 'pending' || x.supersededBy || !w) return;
        var m = missionOfProposal(w, x);
        if (m && byM[m.id]) { byM[m.id].props.push(x); loose[x.id] = 1; }
      });
      return { list: out.filter(function (g) { return g.asks.length || g.props.length; }), taken: loose };
    }, [slice, props]);
    var PC = ui('ProposalCard');
    var anyAsk = groups.list.some(function (g) { return g.asks.length; });
    return html`<div className="app-asks">
      ${!anyAsk && groups.list.length ? html`<p className="app-asks-none">No goal needs a decision from you.</p>` : null}
      ${groups.list.length ? groups.list.map(function (g) {
        return html`<section key=${g.m.id} aria-labelledby=${'asks-m-' + g.m.id} className="app-asks-sec app-asks-mission" data-mission=${g.m.id}>
          <h3 id=${'asks-m-' + g.m.id} className="app-asks-sub app-asks-msub"><a href=${'#missions/' + encodeURIComponent(g.m.id)} onClick=${function (e) { e.preventDefault(); setUi({ drawer: null }); go('missions', g.m.id); }}>${missionGoal(g.m)}</a>
            <span className="app-asks-n">${(g.asks.length + g.props.length) + ' waiting'}</span></h3>
          ${g.asks.length ? html`<ul className="app-ask-list">${g.asks.map(function (a) { return html`<li key=${g.m.id + ':' + a.id}><${AskCard} m=${g.m} a=${a} /></li>`; })}</ul>` : null}
          ${g.props.length ? html`<ul className="app-prop-list">${g.props.map(function (x) { return html`<li key=${x.id}>${PC ? html`<${PC} id=${x.id} showTarget=${true} />` : html`<${ProposalFallback} p=${x} />`}</li>`; })}</ul>` : null}
        </section>`;
      }) : html`<section aria-labelledby="asks-h" className="app-asks-sec"><h3 id="asks-h" className="app-asks-sub">From your goals</h3><p className="app-asks-none">No goal needs a decision from you.</p></section>`}
      <section aria-labelledby="props-h" className="app-asks-sec">
        <h3 id="props-h" className="app-asks-sub">${groups.list.some(function (g) { return g.props.length; }) ? 'Other agent proposals' : 'Agent proposals'}</h3>
        <${ApprovalsPanel} hideIds=${groups.taken} />
      </section>
    </div>`;
  }

  /* ---------------- global search (Cmd/Ctrl+K or "/"): missions, campaigns, audiences, messages, blocks, agents ---------------- */
  var KIND_NOUN = { mission: 'Goal', campaign: 'Campaign', segment: 'Audience', message: 'Message', block: 'Block', agent: 'Agent' };
  var KIND_RANK = { mission: 0, campaign: 1, segment: 2, message: 3, agent: 4, block: 5 };
  function plainText(t) { return String(t || '').replace(/\{(\w+)(?:\|([^}]*))?\}/g, function (x, n, fb) { return fb || n.replace(/_/g, ' '); }); }
  function clip(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + ELL : t; }
  function buildIndex(w) {
    var out = [], K = MC.content, X = MC.xref;
    if (!w) return out;
    function add(kind, id, label, sub, extra) { out.push({ kind: kind, id: id, label: label, sub: sub, hay: (label + ' ' + (extra || '') + ' ' + KIND_NOUN[kind]).toLowerCase() }); }
    (X ? X.missions(w) : []).forEach(function (m) {
      add('mission', m.id, missionGoal(m), 'Goal' + (isLive(m) ? '' : ', ' + m.status), m.title + ' ' + (m.objective ? m.objective.metric : ''));
    });
    if (w.campaigns) (w.campaigns.order || Object.keys(w.campaigns.byId)).forEach(function (id) {
      var c = w.campaigns.byId[id]; if (c) add('campaign', id, c.name, 'Campaign, ' + c.status, (c.channels || []).join(' ') + ' ' + (c.goal ? c.goal.type : ''));
    });
    if (w.segments) (w.segments.order || Object.keys(w.segments.byId)).forEach(function (id) {
      var sg = w.segments.byId[id]; if (sg) add('segment', id, sg.name, 'Audience, ' + nfmt(sg.count) + ' people', '');
    });
    if (K && w.content && w.content.messages) {
      K.messages(w).forEach(function (m) { add('message', m.id, m.name, 'Message', Object.keys(m.tags || {}).map(function (k) { return m.tags[k]; }).join(' ')); });
      K.blocks(w).forEach(function (b) {
        if (b.archived) return;
        var txt = plainText(K.textOf(b));
        add('block', b.id, clip(txt, 90), 'Block, ' + ((K.KIND_LABEL && K.KIND_LABEL[b.kind]) || b.kind).toLowerCase(), txt + ' ' + Object.keys(b.tags || {}).map(function (k) { return b.tags[k]; }).join(' '));
      });
    }
    var seen = {};
    try { (MC.runtime && MC.runtime.defs ? MC.runtime.defs() : []).forEach(function (d) { seen[d.id] = 1; add('agent', d.id, agentName(d.id), 'Agent', d.id + ' ' + (d.role || d.description || '')); }); } catch (e) { /* no runtime */ }
    if (!seen.lead) add('agent', 'lead', 'Lead', 'Agent', 'lead plans missions');
    return out;
  }
  function searchScore(e, words) {
    var l = e.label.toLowerCase(), sc = 0;
    for (var i = 0; i < words.length; i++) {
      var wd = words[i], at = e.hay.indexOf(wd);
      if (at < 0) return -1;
      sc += l.indexOf(wd) === 0 ? 30 : (l.indexOf(' ' + wd) >= 0 ? 20 : (l.indexOf(wd) >= 0 ? 12 : (e.hay.indexOf(' ' + wd) >= 0 ? 6 : 2)));
    }
    return sc;
  }
  function runSearch(index, q) {
    q = String(q || '').trim().toLowerCase();
    var words = q.split(/\s+/).filter(Boolean), res = [];
    if (!words.length) {
      index.forEach(function (e) { if (e.kind === 'mission' && e.sub === 'Mission') res.push({ e: e, s: 0 }); });
      return res.map(function (r) { return r.e; }).slice(0, 8);
    }
    index.forEach(function (e) { var sc = searchScore(e, words); if (sc >= 0) res.push({ e: e, s: sc }); });
    res.sort(function (a, b) { return (b.s - a.s) || (KIND_RANK[a.e.kind] - KIND_RANK[b.e.kind]) || (a.e.label < b.e.label ? -1 : a.e.label > b.e.label ? 1 : 0); });
    return res.slice(0, 14).map(function (r) { return r.e; });
  }
  function openSearch() { setUi({ drawer: 'search' }); }
  function SearchDialog() {
    var drawer = useUi(selDrawer), open = drawer === 'search';
    var qs = useState(''), q = qs[0], setQ = qs[1];
    var cs = useState(0), cur = cs[0], setCur = cs[1];
    var inp = useRef(null), prev = useRef(null);
    var index = useMemo(function () { return open ? buildIndex(MC.store.getState()) : []; }, [open]);
    var results = useMemo(function () { return open ? runSearch(index, q) : []; }, [open, index, q]);
    useEffect(function () {
      if (!open) return undefined;
      prev.current = document.activeElement; setQ(''); setCur(0);
      var raf = window.requestAnimationFrame(function () { if (inp.current) inp.current.focus(); });
      return function () {
        window.cancelAnimationFrame(raf);
        var b = prev.current;
        if (b && b.focus && document.contains(b)) { try { b.focus(); } catch (e) { /* gone */ } }
      };
    }, [open]);
    useEffect(function () { setCur(0); }, [q]);
    useEffect(function () {
      var el = open && document.getElementById('app-search-opt-' + cur);
      if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
    }, [cur, open, results]);
    if (!open) return null;
    function close() { setUi({ drawer: null }); }
    function choose(e) {
      if (!e) return;
      close();
      if (MC.xref) MC.xref.go(e.kind, e.id);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); setCur(results.length ? (cur + 1) % results.length : 0); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); setCur(results.length ? (cur + results.length - 1) % results.length : 0); }
      else if (ev.key === 'Home' && ev.ctrlKey) { ev.preventDefault(); setCur(0); }
      else if (ev.key === 'Enter') { ev.preventDefault(); choose(results[cur]); }
      else if (ev.key === 'Tab') { ev.preventDefault(); if (inp.current) inp.current.focus(); }
    }
    var status = q.trim() ? (results.length ? results.length + (results.length === 1 ? ' result' : ' results') : 'No matches') : 'Goals';
    return html`<div className="app-search-layer k-layer">
      <div className="k-scrim" onClick=${close} aria-hidden="true"></div>
      <div id="app-search" className="app-search" role="dialog" aria-modal="true" aria-label="Search" onKeyDown=${onKey}>
        <div className="app-search-bar"><${Icon} name="search" size=${18} />
          <input id="app-search-input" ref=${inp} className="app-search-input" type="text" role="combobox" autoComplete="off" spellCheck="false"
            aria-expanded="true" aria-controls="app-search-list" aria-autocomplete="list" aria-activedescendant=${results.length ? 'app-search-opt-' + cur : undefined}
            aria-label="Search missions, campaigns, audiences, messages, blocks and agents" placeholder="Search missions, campaigns, audiences, messages, agents"
            value=${q} onChange=${function (e) { setQ(e.target.value); }} />
          <button type="button" className="app-search-esc" onClick=${close} aria-label="Close search">Esc</button>
        </div>
        <p className="app-search-status" role="status" aria-live="polite">${status}</p>
        <ul id="app-search-list" className="app-search-list" role="listbox" aria-label="Results">
          ${results.map(function (e, i) {
            return html`<li key=${e.kind + ':' + e.id} id=${'app-search-opt-' + i} role="option" aria-selected=${i === cur ? 'true' : 'false'} data-kind=${e.kind} data-id=${e.id}
                className=${cx('app-search-opt', i === cur && 'is-cur')} onMouseMove=${function () { if (cur !== i) setCur(i); }} onClick=${function () { choose(e); }}>
              <span className="app-search-kind">${KIND_NOUN[e.kind]}</span><span className="app-search-t">${e.label}</span><span className="app-search-sub">${e.sub}</span></li>`;
          })}
        </ul>
      </div>
    </div>`;
  }
  function useSearchHotkey() {
    useEffect(function () {
      function typing(t) { return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
      function on(e) {
        if (e.defaultPrevented) return;
        var cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K');
        var slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target);
        if (!cmdK && !slash) return;
        var d = MC.uiStore.getState().drawer;
        if (d && d !== 'search') return;
        e.preventDefault();
        setUi({ drawer: d === 'search' && cmdK ? null : 'search' });
      }
      document.addEventListener('keydown', on);
      return function () { document.removeEventListener('keydown', on); };
    }, []);
  }

  /* ---------------- new goal drawer ---------------- */
  function NewGoalPanel() {
    var ts = useState(''), text = ts[0], setText = ts[1];
    var bs = useState(false), busy = bs[0], setBusy = bs[1];
    var es = useState(''), err = es[0], setErr = es[1];
    function submit(ev) {
      if (ev) ev.preventDefault();
      var g = text.trim();
      if (g.length < 8) { setErr('Describe the outcome you want in a sentence.'); return; }
      if (!MC.missions || typeof MC.missions.create !== 'function') { setErr('Missions are still loading. Try again in a moment.'); return; }
      setBusy(true); setErr('');
      var done = function (r) {
        setBusy(false);
        if (r && r.ok) { setText(''); setUi({ drawer: null }); go('missions', r.id || null); }
        else setErr((r && r.error) || "Couldn't start that goal.");
      };
      try { var r = MC.missions.create(g); if (r && typeof r.then === 'function') r.then(done, function (e) { report(e); done(null); }); else done(r); }
      catch (e) { report(e); done(null); }
    }
    return html`<form className="app-goal" onSubmit=${submit}>
      <p className="app-goal-lead">Describe the outcome you want, a deadline and any limits, in one sentence. The agents plan it, start the work and ask you before anything risky.</p>
      <label className="k-label" htmlFor="app-goal-text">Goal</label>
      <textarea id="app-goal-text" className="k-input k-textarea app-goal-text" rows="4" maxLength="300" value=${text} aria-describedby=${err ? 'app-goal-err' : null}
        placeholder="Win back 300 lapsed customers before Dec 20 without discounting more than 10%"
        onChange=${function (e) { setText(e.target.value); }}
        onKeyDown=${function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}></textarea>
      ${err ? html`<p id="app-goal-err" className="k-error" role="alert">${err}</p>` : null}
      <div className="app-goal-actions">
        <button type="submit" id="app-goal-go" className="k-btn k-btn--primary k-btn--md" disabled=${busy} aria-busy=${busy ? 'true' : 'false'}><span className="k-btn-label">${busy ? 'Planning' + ELL : 'Start'}</span></button>
        <span className="app-goal-hint">Ctrl or Cmd + Enter</span>
      </div>
    </form>`;
  }

  /* ---------------- compact menu sheet (phone and narrow tablet) ---------------- */
  function MenuContent() {
    var route = useUi(selRoute);
    var n = useSel(selAskCount) || 0;
    function closeMenu() { setUi({ drawer: null }); }
    return html`<div className="app-menu-sheet">
      <section className="app-menu-section" aria-label="Sections">
        <ul className="app-menu-list">
          <li><button type="button" className="app-menu-item app-menu-new" id="app-menu-new-goal" onClick=${openGoal}><${Icon} name="plus" size=${18} /><span>New goal</span></button></li>
          ${NAV.map(function (a) {
            return html`<li key=${a.route}><a href=${'#' + (a.route === 'agents' ? 'team' : a.route)} id=${'app-menu-nav-' + a.route} className=${cx('app-menu-item', route === a.route && 'is-on')}
                onClick=${function (e) { e.preventDefault(); closeMenu(); go(a.route); }}><${Icon} name=${a.icon} size=${18} /><span>${a.label}${a.count && n ? ' (' + n + ')' : ''}</span></a></li>`;
          })}
          <li><button type="button" className="app-menu-item" onClick=${function () { closeMenu(); openSearch(); }}><${Icon} name="search" size=${18} /><span>Search</span></button></li>
        </ul>
      </section>
      <section className="app-menu-section" aria-label="Connect Claude"><${ConnectButton} /></section>
      <section className="app-menu-section"><${SettingsContent} idp="app-menu" onDone=${closeMenu} /></section>
      <section className="app-menu-section"><${HelpContent} idp="app-menu" onDone=${closeMenu} /></section>
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
      <p>The rest of Marketing Cloud keeps running, and your agents are unaffected.</p>
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
    var failed = p.failed;
    var body = failed ? "Check your connection, then try again." : 'Check back after the next deployment.';
    return html`<section className="app-unbuilt">
      <h1 id="page-title" tabIndex="-1" className="app-page-h1">${title}</h1>
      ${Empty ? html`<${Empty} icon="sparkle" title=${failed ? "This view didn't load." : 'This area is still being built.'} body=${body} />`
        : html`<p>${failed ? "This view didn't load." : 'This area is still being built.'}</p>`}
      ${failed ? html`<button type="button" className="k-btn k-btn--primary k-btn--md" id="app-view-retry" onClick=${p.onRetry}><span className="k-btn-label">Try again</span></button>` : null}
    </section>`;
  }

  // Placeholder blocks in the shape of the Command Center, shown while the world or a view's code is on its way.
  function Skeleton(p) {
    return html`<section className="app-skel" aria-busy="true">
      <h1 id="page-title" tabIndex="-1" className="app-skel-title">${p.title}</h1>
      <p className="app-skel-status" role="status">${p.status || ''}</p>
      <div className="app-skel-lanes" aria-hidden="true">
        <span className="sk sk-lane"></span><span className="sk sk-lane sk-w70"></span><span className="sk sk-lane sk-w50"></span><span className="sk sk-lane sk-w60"></span>
      </div>
    </section>`;
  }

  function ViewHost(p) {
    var rs = useState(0), reloads = rs[0], setReloads = rs[1];
    useLazyVersion();
    var status = p.route === 'approvals' ? 'ready' : lazyStatus(p.route);
    var View = p.route === 'approvals' ? ApprovalsPage : (MC.views && typeof MC.views[p.route] === 'function' ? MC.views[p.route] : null);
    // If the missions view can't load, the legacy Command Center stands in rather than a dead end.
    if (p.route === 'missions' && !View && status === 'error' && MC.views && typeof MC.views.home === 'function') { View = MC.views.home; status = 'ready'; }
    var was = useRef(status);
    useEffect(function () {
      if (status === 'loading') loadLazy(p.route);
    }, [p.route, status, reloads]);
    useEffect(function () {
      // The heading the skeleton showed was replaced by the real one: put focus back on it if it was lost.
      if (was.current === 'loading' && status === 'ready') {
        var a = document.activeElement;
        if (!a || a === document.body) { var h = document.getElementById('page-title'); if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } } }
      }
      was.current = status;
    }, [status]);
    if (status === 'loading') return html`<${Skeleton} title=${TITLES[p.route] || 'Loading'} status=${'Loading ' + (TITLES[p.route] || 'this view') + '…'} />`;
    if (status === 'error') return html`<${Unbuilt} route=${p.route} failed=${true} onRetry=${function () { delete lazyState[p.route]; setReloads(reloads + 1); lazyNotify(); }} />`;
    return html`<${ErrorBoundary} key=${p.route + ':' + reloads} onReload=${function () { setReloads(reloads + 1); }}>
      ${View ? html`<${View} />` : html`<${Unbuilt} route=${p.route} />`}
    <//>`;
  }

  /* ---------------- boot ---------------- */
  var PHASES = [
    { id: 'profiles', label: 'Loading 6,000 customer profiles' },
    { id: 'history', label: 'Loading 60 days of campaign history' },
    { id: 'scores', label: 'Scoring propensity, churn and lifetime value' },
    { id: 'agents', label: 'Starting the agents' },
    { id: 'catchup', label: 'Catching up to today' }
  ];
  function BootCard(p) {
    var idx = -1;
    PHASES.forEach(function (ph, i) { if (ph.id === p.phase) idx = i; });
    if (p.error) {
      return html`<section className="app-bootcard app-bootcard--error" role="alert">
        <h1 id="page-title" tabIndex="-1" className="app-page-h1">Marketing Cloud couldn't load the sample workspace.</h1>
        <p>${p.error}</p>
        <button type="button" className="k-btn k-btn--primary k-btn--md" id="app-boot-retry" onClick=${p.onRetry}><span className="k-btn-label">Try again</span></button>
      </section>`;
    }
    var label = idx >= 0 ? PHASES[idx].label : 'Loading Fernway Outfitters';
    return html`<${Skeleton} title=${TITLES[p.route] || 'Home'} status=${label + ELL} />`;
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
      try { return ((MC.contract && MC.contract.check ? MC.contract.check().missing : []) || []).filter(function (m) { return !/^MC\.views\.(\w+)$/.test(m) || !LAZY[RegExp.$1] || m === 'MC.views.home'; }); } catch (e) { return []; }
    }, [ready]);
    if (!missing.length) return null;
    return html`<details className="app-devcheck">
      <summary>${'Build check: ' + missing.length + (missing.length === 1 ? ' piece' : ' pieces') + ' of the app ' + (missing.length === 1 ? "isn't" : "aren't") + ' loaded yet'}</summary>
      <p>Parts of Marketing Cloud that depend on these show a fallback until they ship.</p>
      <ul>${missing.map(function (m) { return html`<li key=${m}><code>${m}</code></li>`; })}</ul>
    </details>`;
  }

  /* ---------------- guided first run (js/views/tour.js, loaded only when it can start) ---------------- */
  function tourEligible() {
    try { if (navigator.webdriver && !window.MC_TOUR_FORCE) return false; } catch (e) { /* ignore */ }
    var h = String(window.location.hash || '').replace(/^#/, '');
    if (h && h !== 'home' && h !== 'missions') return false;
    var f = MC.uiStore.getState().firstRun;
    return !f || (!f.done && !f.skipped);
  }
  function startTour() {
    loadLazy('tour').then(function () { if (MC.tour && MC.tour.start) MC.tour.start(); }, report);
  }
  var tourWanted = tourEligible();

  /* ---------------- app ---------------- */
  function focusMain() {
    var t = document.getElementById('page-title') || document.getElementById('app-main');
    if (t && t.focus) t.focus();
  }
  function App() {
    var boot = useBoot();
    var ready = useSel(selReady);
    var rawRoute = useUi(selRoute) || 'missions';
    var route = rawRoute;
    var drawer = useUi(selDrawer);
    var theme = useUi(selTheme);
    var focus = useUi(selMissionFocus);
    var slice = useSel(selMissions);
    var compact = useMedia('(max-width: 759.98px)');
    var Drawer = ui('Drawer'), Toasts = ui('ToastHost');
    var first = useRef(true);
    useLazyVersion();
    useSearchHotkey();
    useEffect(function () {
      if (!ready) return undefined;
      if (tourWanted) loadLazy('tour').catch(report);
      var t = window.setTimeout(prefetchViews, 2500);
      return function () { window.clearTimeout(t); };
    }, [ready]);

    useEffect(function () { MC.uiStore.applyTheme(theme); }, [theme]);
    var goalTitle = null;
    if (route === 'missions' && focus && slice && slice.byId && slice.byId[focus]) goalTitle = missionGoal(slice.byId[focus]);
    useEffect(function () {
      try { document.title = (goalTitle || TITLES[route] || 'Home') + ' \u00b7 Marketing Cloud'; } catch (e) { /* no document */ }
    }, [route, goalTitle]);
    useEffect(function () {
      if (first.current) { first.current = false; return undefined; }
      // A route change is a person's navigation: start at the top and move focus to the page heading.
      var raf = window.requestAnimationFrame(function () {
        try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
        var h = document.getElementById('page-title');
        if (h && h.focus) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
      });
      return function () { window.cancelAnimationFrame(raf); };
    }, [route, focus]);
    useEffect(function () { if (!compact && drawer === 'menu') setUi({ drawer: null }); }, [compact]);

    function closeDrawer() { setUi({ drawer: null }); }
    return html`<div className=${cx('app-shell', compact && 'is-compact')}>
      <button type="button" className="app-skip" onClick=${focusMain}>Skip to content</button>
      ${compact ? null : html`<${Rail} />`}
      <main id="app-main" className=${cx('app-main', 'app-main--' + route)} tabIndex="-1">
        ${ready ? html`<${ViewHost} route=${route} />` : html`<${BootCard} phase=${boot.phase} route=${route} error=${boot.error} onRetry=${startBoot} />`}
        <${DevCheck} />
      </main>
      ${Drawer ? html`<${Drawer} id="approvals-drawer" open=${drawer === 'approvals'} onClose=${closeDrawer} title="Asks" width=${480}>
        <${AsksPanel} />
      <//>` : null}
      ${Drawer ? html`<${Drawer} id="goal-drawer" open=${drawer === 'goal'} onClose=${closeDrawer} title="New goal" width=${440} initialFocus="#app-goal-text">
        <${NewGoalPanel} />
      <//>` : null}
      ${Drawer && MC.connect ? html`<${Drawer} id="connect-drawer" open=${drawer === 'connect'} onClose=${closeDrawer} title=${MC.connect.TITLE || 'Connect Claude'} initialFocus=${MC.connect.INITIAL_FOCUS} width=${400}>
        <${MC.connect.Panel} onClose=${closeDrawer} />
      <//>` : null}
      ${Drawer ? html`<${Drawer} id="app-menu" side="bottom" open=${drawer === 'menu'} onClose=${closeDrawer} title="Menu">
        <${MenuContent} />
      <//>` : null}
      <${SearchDialog} />
      ${compact ? html`<${BottomBar} />` : null}
      ${Toasts ? html`<${Toasts} />` : null}
      ${MC.tour && MC.tour.Host ? html`<${MC.tour.Host} />` : null}
    </div>`;
  }

  /* ---------------- mount ---------------- */
  try { MC.uiStore.applyTheme(MC.uiStore.getState().theme); } catch (e) { report(e); }
  try {
    var reactRoot = window.ReactDOM.createRoot(root);
    reactRoot.render(html`<${App} />`);
  } catch (e) {
    report(e);
    bootMessage("Marketing Cloud couldn't start.", 'The interface failed to render. Reload the page to try again.');
    return;
  }
  watchToasts();
  loadLazy('connect').catch(report);
  // Let the boot card paint before the (synchronous) world generation starts.
  window.requestAnimationFrame(function () { window.setTimeout(startBoot, 0); });
})();
