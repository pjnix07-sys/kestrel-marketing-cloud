/* Marketing Cloud - guided first run for missions. Four small anchored notes, one at a time, no overlay, no timed
   sequence: each note points at a real thing on screen right now (the goal sentence and lanes, an ask, the Lead
   column, New goal). Views mark those things with data-tour="goal|lanes|ask|lead"; the shell supplies fallbacks.
   State lives in uiStore.firstRun (persisted with the other UI conveniences), never in the world or action log.
   Exposes MC.tour = { Host, Inline, start }. Loaded by app.js only when the guide can start or is asked for. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var React = window.React, ReactDOM = window.ReactDOM;
  if (!React || !ReactDOM || !MC.uiStore || !MC.hooks || !MC.store) return;
  var html = MC.html || window.htm.bind(React.createElement);
  var useState = React.useState, useEffect = React.useEffect, useLayoutEffect = React.useLayoutEffect, useRef = React.useRef;

  var IDLE_MS = 3000, MANUAL_IDLE_MS = 1200;
  var D = document;
  var WEBDRIVER = false;
  try { WEBDRIVER = !!navigator.webdriver && !window.MC_TOUR_FORCE; } catch (e) { /* ignore */ }
  var DEEPLINK = (function () { var h = String(window.location.hash || '').replace(/^#/, ''); return !!h && h !== 'home' && h !== 'missions'; })();
  var TOTAL = 4;
  var FRESH = { step: 1, done: false, skipped: false, resumes: 0, shown: 0 };

  var STEPS = {
    1: { route: 'missions', sel: ['[data-tour="goal"]', '#page-title', '#app-mission-tabs', '#app-mission-menu'], where: 'after',
      copy: 'This is a goal, in one sentence. Each agent works it on its own lane: finished work fills in, queued work waits, and hand-offs show who passed what to whom.' },
    2: { route: 'missions', sel: ['[data-tour="ask"]', '#app-asks-btn'], where: 'after',
      copy: 'When the team needs a decision only you can make, it lands here as an ask with the reason and what each answer changes.',
      zeroCopy: 'Nothing is waiting on you right now. When an agent needs a decision, it appears under Asks with the reason and the impact.' },
    3: { route: 'missions', sel: ['[data-tour="lead"]', '#app-mission-tabs', '#app-mission-menu'], where: 'after',
      copy: 'Steer in plain language in the Lead column, for example "keep it under 10%" or "skip SMS". The Lead answers and the plan re-forms on the board.' },
    4: { route: 'missions', sel: ['#app-new-goal'], where: 'after',
      copy: 'Give the team a new goal in one sentence. It joins the missions here and the Lead starts planning.' }
  };

  /* ---------------- runtime (not persisted) ---------------- */
  var R = { shown: null, copy: '', lastInput: Date.now(), manual: false, sawDrawer: false, pending: null, zeroSince: null, scrolledFor: 0 };
  var subs = [];
  function emit() { subs.slice().forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); }
  function useRuntime() {
    var st = useState(0);
    useEffect(function () { var f = function () { st[1](function (n) { return n + 1; }); }; subs.push(f); return function () { var i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; }, []);
    return R;
  }
  function phone() { try { return window.matchMedia('(max-width: 639.98px)').matches; } catch (e) { return false; } }
  function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  function ui() { return MC.uiStore.getState(); }
  function stored() { return ui().firstRun; }
  function current() { var f = stored(); if (f) return f; return WEBDRIVER || DEEPLINK ? null : FRESH; }
  function isActive(f) { return !!f && !f.done && !f.skipped; }
  function write(patch) { MC.uiStore.set({ firstRun: Object.assign({}, stored() || FRESH, patch) }); }
  function layerOpen() { return !!(ui().drawer || D.querySelector('[role="dialog"]')); }
  function typing() {
    var a = D.activeElement;
    return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  }
  function openCount() {
    var w = MC.store.getState(), n = 0;
    if (!w) return 0;
    if (w.proposals && w.proposals.open) n += w.proposals.open.length;
    var ms = w.missions;
    if (ms && ms.order) ms.order.forEach(function (id) { var m = ms.byId[id]; if (m && m.status !== 'done' && m.status !== 'stopped') (m.asks || []).forEach(function (a) { if (a.status === 'open') n++; }); });
    return n;
  }
  function routeKey() { var r = ui().route; return r === 'home' ? 'missions' : r; }
  function pendingIds() {
    var w = MC.store.getState();
    var p = w && w.proposals;
    if (!p || !p.open) return [];
    return p.open.filter(function (id) { return p.byId[id] && p.byId[id].status === 'pending'; });
  }
  function stepDef(n) { return STEPS[n]; }
  function anchorFor(n) {
    var def = stepDef(n), list = phone() && def.phoneSel ? def.phoneSel : def.sel;
    for (var i = 0; list && i < list.length; i++) {
      var el = D.querySelector(list[i]);
      if (el) { var r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return el; }
    }
    return null;
  }
  function copyFor(n) {
    var def = stepDef(n);
    if (n === 2 && openCount() === 0) return def.zeroCopy;
    return def.copy;
  }

  /* ---------------- transitions ---------------- */
  function refocus(anchor) {
    var a = D.activeElement;
    if (!a || !a.closest || !a.closest('.tour-note')) return;
    if (D.documentElement.getAttribute('data-input') !== 'keyboard') return;
    var t = anchor && /^(BUTTON|A)$/.test(anchor.tagName) ? anchor : D.getElementById('page-title');
    if (t && t.focus) { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
  }
  function hide() {
    if (R.shown === null) return;
    var anchor = anchorFor(R.shown);
    refocus(anchor);
    R.shown = null; R.copy = ''; emit();
  }
  function advance(from) {
    hide();
    if (from >= TOTAL) write({ step: TOTAL, done: true }); else write({ step: from + 1 });
  }
  function skip() { hide(); write({ skipped: true }); }
  function show(n) {
    var f = current() || FRESH;
    R.copy = copyFor(n); R.shown = n; R.manual = false;
    write({ step: n, shown: Math.max(f.shown || 0, n) });
    emit();
  }
  function start() {
    R.shown = null; R.sawDrawer = false; R.pending = null; R.manual = true; R.lastInput = 0;
    MC.uiStore.set({ firstRun: Object.assign({}, FRESH), drawer: null });
    if (routeKey() !== 'missions') MC.nav.go('missions');
    emit();
  }

  /* ---------------- what the person does ---------------- */
  function onUi() {
    var s = ui(), f = current();
    if (!isActive(f)) { if (R.shown !== null) hide(); return; }
    var step = f.step;
    if (s.drawer === 'approvals' && step === 2) { hide(); write({ step: 3 }); return; }   // opening Asks on their own marks step 2 done
    if (s.drawer === 'goal' && step === 4) { hide(); write({ step: 4, done: true }); return; }
    if (R.shown !== null) {
      var def = stepDef(R.shown);
      if (routeKey() !== def.route) advance(R.shown);                      // navigating away marks the step done
      else if (layerOpen()) hide();                                        // a drawer or menu took over: wait for it to close
    }
  }
  function onWorld() { /* the copy for step 2 is read from the live state when the note is shown */ }

  /* ---------------- when to show ---------------- */
  function inView(el) {
    var r = el.getBoundingClientRect(), vh = window.innerHeight || 800;
    return r.bottom > 0 && r.top < vh - 24;
  }
  function check() {
    if (R.shown !== null || D.visibilityState === 'hidden') return;
    var f = current();
    if (!isActive(f) || !MC.store.getState()) return;
    var n = f.step, s = ui();
    if (typing()) return;
    var wait = R.manual ? MANUAL_IDLE_MS : IDLE_MS;
    if (Date.now() - R.lastInput < wait) return;
    if (layerOpen()) return;
    var def = stepDef(n);
    if (routeKey() !== def.route) return;
    if (n === 1 && !R.manual && !s.sampleDismissed) return;
    var a = anchorFor(n);
    if (!a) return;
    if (!inView(a)) {
      if (R.scrolledFor !== n) { R.scrolledFor = n; try { a.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { a.scrollIntoView(); } }
      return;
    }
    show(n);
  }

  /* ---------------- components ---------------- */
  function Note(p) {
    var n = p.step, last = n === TOTAL;
    return html`<div className=${'tour-note ' + (p.cls || '')} style=${p.style} role="group" aria-label=${'Guide, step ' + n + ' of ' + TOTAL} ref=${p.boxRef}>
      <p className="tour-step">${'Step ' + n + ' of ' + TOTAL}</p>
      <p className="tour-copy">${p.copy}</p>
      <div className="tour-actions">
        <button type="button" className="k-link tour-skip" onClick=${skip}>Skip guide</button>
        <button type="button" className="k-btn k-btn--primary k-btn--sm" id="tour-next" onClick=${function () { advance(n); }}><span className="k-btn-label">${last ? 'Done' : 'Next'}</span></button>
      </div>
    </div>`;
  }

  function Floating(p) {
    var hs = useState(null), host = hs[0], setHost = hs[1];
    var ps = useState(null), pos = ps[0], setPos = ps[1];
    var box = useRef(null);
    var n = p.step;
    useLayoutEffect(function () {
      var a = anchorFor(n);
      if (!a || !a.parentNode) { hide(); return undefined; }
      var h = D.createElement('div');
      h.className = 'tour-host';
      a.parentNode.insertBefore(h, stepDef(n).where === 'before' ? a : a.nextSibling);
      setHost(h);
      return function () { if (h.parentNode) h.parentNode.removeChild(h); setHost(null); };
    }, [n]);
    useLayoutEffect(function () {
      if (!host) return undefined;
      function place() {
        var a = anchorFor(n), el = box.current;
        if (!a) { hide(); return; }
        if (!el) return;
        var r = a.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
        var w = el.offsetWidth, h = el.offsetHeight, gap = 12, side = 'bottom', top, left;
        if (stepDef(n).side === 'right' && r.right + gap + w <= vw - 8) {
          side = 'right'; left = r.right + gap; top = Math.max(8, Math.min(r.top + r.height / 2 - h / 2, vh - h - 8));
        } else {
          top = r.bottom + gap;
          if (top + h > vh - 8 && r.top - gap - h > 8) { side = 'top'; top = r.top - gap - h; }
          left = Math.max(8, Math.min(r.left, vw - w - 8));
        }
        var ax = Math.max(18, Math.min(r.left + Math.min(r.width, 160) / 2 - left, w - 18));
        var ay = Math.max(18, Math.min(r.top + r.height / 2 - top, h - 18));
        setPos(function (o) { return o && o.top === top && o.left === left && o.side === side && o.ax === ax && o.ay === ay ? o : { top: top, left: left, side: side, ax: ax, ay: ay }; });
      }
      place();
      var raf = window.requestAnimationFrame(place);
      var iv = window.setInterval(place, 400);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      return function () { window.cancelAnimationFrame(raf); window.clearInterval(iv); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [host, n]);
    if (!host) return null;
    var style = pos ? { top: pos.top + 'px', left: pos.left + 'px', '--tour-ax': pos.ax + 'px', '--tour-ay': pos.ay + 'px' } : { top: 0, left: 0 };
    return ReactDOM.createPortal(html`<${Note} step=${n} copy=${p.copy} boxRef=${box} style=${style}
      cls=${'tour-note--float' + (pos ? ' tour-note--' + pos.side : ' is-pending')} />`, host);
  }

  // Kept for the shell's contract; the first run no longer places a note inside the Asks drawer.
  function Inline() { return null; }

  function Host() {
    var r = useRuntime();
    useEffect(function () {
      var offUi = MC.uiStore.subscribe(onUi), offW = MC.store.subscribe(onWorld);
      function seen() { R.lastInput = Date.now(); }
      var evs = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'];
      evs.forEach(function (e) { D.addEventListener(e, seen, true); });
      function onKey(e) {
        if (e.key !== 'Escape' || e.defaultPrevented || R.shown === null) return;
        var t = e.target, inNote = !!(t && t.closest && t.closest('.tour-note'));
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if (layerOpen() && !inNote) return;
        e.preventDefault(); e.stopPropagation(); skip();
      }
      D.addEventListener('keydown', onKey, true);
      var iv = window.setInterval(check, 500);
      onWorld(); onUi();
      return function () {
        if (typeof offUi === 'function') offUi(); if (typeof offW === 'function') offW();
        evs.forEach(function (e) { D.removeEventListener(e, seen, true); });
        D.removeEventListener('keydown', onKey, true);
        window.clearInterval(iv);
      };
    }, []);
    var live = r.shown !== null ? 'Guide, step ' + r.shown + ' of ' + TOTAL + '. ' + r.copy + ' Press Escape to skip the guide.' : '';
    return html`<div>
      <div className="tour-live" role="status" aria-live="polite">${r.shown !== null ? live : ''}</div>
      ${r.shown !== null ? html`<${Floating} key=${r.shown} step=${r.shown} copy=${r.copy} />` : null}
    </div>`;
  }

  MC.tour = { Host: Host, Inline: Inline, start: start };
  emit();
})();
