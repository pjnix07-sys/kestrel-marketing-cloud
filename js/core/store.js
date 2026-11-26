/* Marketing Cloud - MC.store (live world + batched notify), MC.uiStore (ephemeral UI
   state, conveniences persisted in localStorage), MC.nav (bare-hash routing) and the data hooks
   (useSelect, useShallow, useUi, useTick, useDraft, useFrozen, useDebounced). */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var S = MC.store = MC.store || {};
  var UI = MC.uiStore = MC.uiStore || {};
  var NAV = MC.nav = MC.nav || {};
  var H = MC.hooks = MC.hooks || {};
  var assign = Object.assign;

  function report(e) { if (window.console && console.error) console.error(e); }

  /* ======================= world store ======================= */
  var live = null;
  var version = 0;
  var subs = [];
  var depth = 0;
  var pending = false;
  var scheduled = false;

  function emit() {
    pending = false;
    version++;
    var list = subs.slice();
    for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) { report(e); } }
  }
  function schedule() {
    if (depth > 0) { pending = true; return; }
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(function () { scheduled = false; emit(); });
  }

  S.init = function (world) { live = world; emit(); };
  S.getState = function () { return live; };
  S.version = function () { return version; };
  S.subscribe = function (fn) {
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  };
  S.notify = function () { schedule(); };

  // USER path: validate (origin 'user'), stamp {seq, tick}, append world.log, reduce, one microtask notify.
  S.dispatch = function (action) {
    if (!live) return { ok: false, error: 'The sample world is still loading.' };
    var r = MC.catalog.dispatchUser(live, action);
    if (r.ok) schedule();
    return r;
  };

  // Live-world wrapper of MC.catalog.apply for non-user origins.
  S.applyInternal = function (action, origin) {
    if (!live) return { ok: false, error: 'The sample world is still loading.' };
    var r = MC.catalog.apply(live, action, { origin: origin || 'runtime', tick: live.meta.tick });
    if (r.ok) schedule();
    return r;
  };

  // Nested-safe; exactly one synchronous notify when the outermost batch ends.
  S.batch = function (fn) {
    depth++;
    pending = true;
    try { return fn(); } finally {
      depth--;
      if (depth === 0 && pending) emit();
    }
  };

  S.bump = function (key) {
    if (!live) return;
    MC.util.bump(live, key);
    schedule();
  };

  /* ======================= ui store ======================= */
  var LS_KEY = 'mc.ui.v1';
  var ROUTES = MC.ROUTES || ['home', 'campaigns', 'content', 'audiences', 'analytics', 'agents'];
  var THEMES = ['system', 'light', 'dark'];
  var NOTIFY_LEVELS = ['all', 'changes', 'silent'];

  function defaultNotify() {
    var o = {};
    (MC.AGENT_IDS || []).forEach(function (id) { o[id] = 'changes'; });
    return o;
  }
  function defaults() {
    return {
      theme: 'system', route: 'home', drawer: null, sampleDismissed: false, firstRun: null, verifying: null,
      focus: {
        campaigns: { mode: 'board', id: null, tab: 'overview' },
        content: { variantId: null, channel: 'email' },
        audiences: { tab: 'segments', segmentId: null, profileIdx: null },
        analytics: { range: 30, campaignIds: [], channel: 'all', metric: 'revenue', showAgents: true },
        agents: { tab: 'roster', agentId: 'optimizer', auditId: null }
      },
      plannerBrief: null, toasts: [], notify: defaultNotify()
    };
  }

  function readPersisted() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch (e) { return null; }
  }
  function persisted(s) { return { theme: s.theme, route: s.route, sampleDismissed: s.sampleDismissed, firstRun: s.firstRun, notify: s.notify }; }
  var lastPersist = '';
  function writePersisted(s) {
    try {
      var str = JSON.stringify(persisted(s));
      if (str === lastPersist) return;
      lastPersist = str;
      if (window.localStorage) window.localStorage.setItem(LS_KEY, str);
    } catch (e) { /* storage unavailable: conveniences only */ }
  }

  function hashRoute() {
    var h = '';
    try { h = String(window.location.hash || '').replace(/^#/, ''); } catch (e) { h = ''; }
    return h;
  }

  // Guided first run (docs/DEMO.md part 2): {step 1..6, done, skipped, resumes, shown}. Lives in this UI state only,
  // never in the world or the action log. A guide left mid-way resumes once on the next visit, then ends.
  function readFirstRun(v) {
    if (!v || typeof v !== 'object') return null;
    var step = Math.max(1, Math.min(6, v.step | 0 || 1));
    var out = { step: step, done: v.done === true, skipped: v.skipped === true, resumes: Math.max(0, v.resumes | 0), shown: Math.max(0, v.shown | 0) };
    if (!out.done && !out.skipped) {
      if (out.resumes >= 1) out.done = true;
      else out.resumes = 1;
    }
    return out;
  }

  function initialState() {
    var s = defaults();
    var p = readPersisted();
    if (p) {
      if (THEMES.indexOf(p.theme) >= 0) s.theme = p.theme;
      if (typeof p.sampleDismissed === 'boolean') s.sampleDismissed = p.sampleDismissed;
      s.firstRun = readFirstRun(p.firstRun);
      if (p.notify && typeof p.notify === 'object') {
        Object.keys(p.notify).forEach(function (k) { if (NOTIFY_LEVELS.indexOf(p.notify[k]) >= 0) s.notify[k] = p.notify[k]; });
      }
    }
    var h = hashRoute();
    if (ROUTES.indexOf(h) >= 0) s.route = h;
    else if (!h && p && ROUTES.indexOf(p.route) >= 0) s.route = p.route;   // restore last area on a bare URL
    else s.route = 'home';
    return s;
  }

  var uiState = initialState();
  if (uiState.firstRun && !uiState.firstRun.done && !uiState.firstRun.skipped) writePersisted(uiState);   // count this visit as the one resume
  var uiVersion = 0;
  var uiSubs = [];

  function uiEmit() {
    uiVersion++;
    var list = uiSubs.slice();
    for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) { report(e); } }
  }

  UI.getState = function () { return uiState; };
  UI.version = function () { return uiVersion; };
  UI.subscribe = function (fn) {
    uiSubs.push(fn);
    return function () { var i = uiSubs.indexOf(fn); if (i >= 0) uiSubs.splice(i, 1); };
  };
  // Shallow-merges a patch (or fn(state) -> patch) into the state; notifies synchronously.
  UI.set = function (patchOrFn) {
    var patch = typeof patchOrFn === 'function' ? patchOrFn(uiState) : patchOrFn;
    if (!patch || typeof patch !== 'object') return;
    var next = assign({}, uiState, patch);
    if (MC.util.shallowEqual(next, uiState)) return;
    uiState = next;
    writePersisted(uiState);
    uiEmit();
  };
  // Merge into focus[view].
  UI.setFocus = function (view, patch) {
    UI.set(function (s) {
      var f = assign({}, s.focus);
      f[view] = assign({}, s.focus[view], patch);
      return { focus: f };
    });
  };
  UI.setNotify = function (agentId, level) {
    if (NOTIFY_LEVELS.indexOf(level) < 0) return;
    UI.set(function (s) { var n = assign({}, s.notify); n[agentId] = level; return { notify: n }; });
  };
  var toastSeq = 0;
  UI.addToast = function (t) {
    toastSeq++;
    var item = assign({ id: 't' + toastSeq, tone: 'neutral', actions: [] }, t);
    UI.set(function (s) { return { toasts: s.toasts.concat([item]).slice(-3) }; });
    return item.id;
  };
  UI.dismissToast = function (id) {
    UI.set(function (s) { return { toasts: s.toasts.filter(function (x) { return x.id !== id; }) }; });
  };
  UI.clearToasts = function () { UI.set({ toasts: [] }); };
  // Applies the theme attribute to <html>: none for system.
  UI.applyTheme = function (theme) {
    try {
      var el = document.documentElement;
      if (theme === 'light' || theme === 'dark') el.setAttribute('data-theme', theme);
      else el.removeAttribute('data-theme');
    } catch (e) { /* no document */ }
  };
  UI.reset = function () { uiState = assign(defaults(), persisted(uiState)); uiEmit(); };

  /* ======================= nav ======================= */
  NAV.ROUTES = ROUTES;
  NAV.route = function () { return uiState.route; };
  NAV.go = function (route, focusPatch) {
    var r = ROUTES.indexOf(route) >= 0 ? route : 'home';
    UI.set(function (s) {
      var out = { route: r };
      if (focusPatch && typeof focusPatch === 'object') {
        var f = assign({}, s.focus);
        f[r] = assign({}, s.focus[r], focusPatch);
        out.focus = f;
      }
      return out;
    });
    try { if (window.location.hash !== '#' + r) window.location.hash = '#' + r; } catch (e) { /* no location */ }
  };
  try {
    window.addEventListener('hashchange', function () {
      var h = hashRoute();
      var r = ROUTES.indexOf(h) >= 0 ? h : 'home';
      if (r !== uiState.route) UI.set({ route: r });
    });
  } catch (e) { /* no window events */ }

  /* ======================= hooks ======================= */
  function R() { return window.React; }

  // Generic external-store hook with a cached snapshot: recomputes only when the store version
  // or the selector changes, and returns the previous value when eq(prev, next).
  function useStoreSelect(subscribe, getVersion, getRoot, sel, eq) {
    var React = R();
    var ref = React.useRef(null);
    if (ref.current === null) ref.current = { has: false, value: undefined, version: -1, sel: null };
    var getSnapshot = function () {
      var c = ref.current, v = getVersion();
      if (c.has && c.version === v && c.sel === sel) return c.value;
      var root = getRoot();
      var next = root ? sel(root) : undefined;
      if (c.has && eq(c.value, next)) next = c.value;
      c.has = true; c.value = next; c.version = v; c.sel = sel;
      return next;
    };
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  H.useSelect = function (sel, eq) {
    return useStoreSelect(S.subscribe, S.version, S.getState, sel, eq || Object.is);
  };
  H.useShallow = function (sel) { return H.useSelect(sel, MC.util.shallowEqual); };
  H.useUi = function (sel, eq) {
    return useStoreSelect(UI.subscribe, UI.version, UI.getState, sel || identity, eq || Object.is);
  };
  function identity(x) { return x; }
  function selTick(w) { return w.meta.tick; }
  H.useTick = function () { return H.useSelect(selTick); };

  // Local draft of store-owned data. Never replaced while dirty; a change underneath raises `conflict`.
  H.useDraft = function (source, opts) {
    var React = R();
    opts = opts || {};
    var eq = opts.eq || MC.util.deepEqual;
    var pair = React.useState(function () {
      return { value: source, base: source, seen: source, theirs: undefined, conflict: false };
    });
    var st = pair[0], setSt = pair[1];
    var cur = st;
    if (!eq(source, st.seen)) {
      var dirty = !eq(st.value, st.base);
      cur = dirty
        ? assign({}, st, { seen: source, theirs: source, conflict: true })
        : { value: source, base: source, seen: source, theirs: undefined, conflict: false };
      setSt(cur);
    }
    var latest = React.useRef(cur);
    latest.current = cur;
    var onCommit = React.useRef(opts.onCommit);
    onCommit.current = opts.onCommit;

    return {
      value: cur.value,
      dirty: !eq(cur.value, cur.base),
      conflict: cur.conflict,
      theirs: cur.theirs,
      set: function (v) {
        setSt(function (s) { return assign({}, s, { value: typeof v === 'function' ? v(s.value) : v }); });
      },
      reset: function () {
        setSt(function (s) { return { value: s.seen, base: s.seen, seen: s.seen, theirs: undefined, conflict: false }; });
      },
      takeTheirs: function () {
        setSt(function (s) { return { value: s.seen, base: s.seen, seen: s.seen, theirs: undefined, conflict: false }; });
      },
      keepMine: function () {
        setSt(function (s) { return assign({}, s, { base: s.seen, theirs: undefined, conflict: false }); });
      },
      commit: function () {
        var v = latest.current.value;
        var r = onCommit.current ? onCommit.current(v) : { ok: true };
        if (!r || r.ok !== false) {
          setSt(function (s) { return assign({}, s, { base: v, theirs: undefined, conflict: false }); });
        }
        return r;
      }
    };
  };

  // Freezes list membership/order while `freeze` is true; values of frozen rows still update by key.
  H.useFrozen = function (list, opts) {
    var React = R();
    opts = opts || {};
    var key = opts.key || 'id';
    var kf = typeof key === 'function' ? key : function (x) { return x && x[key]; };
    var snap = React.useRef(null);
    var latest = React.useRef(list);
    latest.current = list || [];
    var force = React.useState(0)[1];
    var items = latest.current;
    if (!opts.freeze) {
      snap.current = null;
      return { items: items, pending: 0, reveal: noop };
    }
    if (snap.current === null) snap.current = items;
    var byKey = {}, seen = {};
    items.forEach(function (x) { byKey[kf(x)] = x; });
    var shown = snap.current.map(function (x) { var k = kf(x); seen[k] = true; return byKey[k] || x; });
    var pendingCount = 0;
    items.forEach(function (x) { if (!seen[kf(x)]) pendingCount++; });
    return {
      items: shown,
      pending: pendingCount,
      reveal: function () { snap.current = latest.current; force(function (n) { return n + 1; }); }
    };
  };
  function noop() {}

  H.useDebounced = function (value, ms) {
    var React = R();
    var pair = React.useState(value);
    React.useEffect(function () {
      var t = setTimeout(function () { pair[1](value); }, ms === undefined ? 150 : ms);
      return function () { clearTimeout(t); };
    }, [value, ms]);
    return pair[0];
  };
})();
