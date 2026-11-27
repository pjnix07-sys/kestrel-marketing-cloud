/* Marketing Cloud - MC.engine: boots the Fernway Outfitters sample world and keeps it moving.
   One tick = one hour of world time. The wall-clock scheduler is a setTimeout chain that runs
   continuously at one default pace (PACE_MS) regardless of which view is open; each fire advances
   exactly one tick inside a single store batch, so subscribers see one notify per tick.
   Pacing lives only here (§11.1): the UI exposes no speed or clock. setSpeed/getSpeed/step remain for
   internal and dev use (headless tests pause; the overflow menu's "Jump ahead" calls step).
   advance(world) is the shared tick pipeline used by both the live world and replay. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var E = MC.engine = MC.engine || {};

  var assign = Object.assign;
  // Default pace: one world hour every 1.2 s (a day in about 29 s). Other keys are dev-only.
  E.PACE_MS = 1200;
  E.DEFAULT_SPEED = '1x';
  E.SPEEDS = { pause: 0, '1x': E.PACE_MS, '4x': E.PACE_MS / 4, '16x': E.PACE_MS / 16 };
  E.SPEED_KEYS = ['pause', '1x', '4x', '16x'];
  E.PHASES = [
    { id: 'profiles', label: 'Generating 6,000 sample customer profiles' },
    { id: 'history', label: 'Replaying 60 days of sample history' },
    { id: 'scores', label: 'Scoring propensity, churn and lifetime value' },
    { id: 'agents', label: 'Starting the eight agents' }
  ];

  var speed = 'pause';
  var timer = null;
  var booted = false;
  var bootPromise = null;
  var listeners = [];
  E.checkpoints = {};
  E.lastTickMs = 0;
  E.lastError = null;

  function now() { return MC.util.now(); }
  function report(e) { if (window.console && console.error) console.error(e); }
  function emit() {
    var l = listeners.slice();
    for (var i = 0; i < l.length; i++) { try { l[i](); } catch (e) { report(e); } }
  }
  // Engine-level listeners (speed changes, tick timing). The store notifies world changes.
  E.subscribe = function (fn) {
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };

  /* ======================= tick pipeline (§10.6) ======================= */
  // Prepares a freshly generated world (adds any registered agent missing from it). Live and replay share it.
  E.prepare = function (world) {
    if (MC.runtime && typeof MC.runtime.ensureAgents === 'function') MC.runtime.ensureAgents(world);
    return world;
  };

  // ONE tick on the given world; no store access.
  E.advance = function (world) {
    var t = world.meta.tick + 1;
    world.meta = assign({}, world.meta, { tick: t });
    var h = MC.time.hourOf(t), d = MC.time.dayOf(t);
    if (h === 0) MC.sim.dayRoll(world, d);
    MC.sim.step(world, t);
    if (MC.runtime && typeof MC.runtime.runDue === 'function') MC.runtime.runDue(world, t);
    if (MC.missions && typeof MC.missions.advance === 'function') MC.missions.advance(world, t);
    return world;
  };

  function pauseWithError(e) {
    report(e);
    E.lastError = e;
    E.setSpeed('pause');
    try {
      if (MC.uiStore && MC.uiStore.addToast) {
        MC.uiStore.addToast({ text: "Live updates stopped after a problem. Your work is safe; reload the page to start fresh.", tone: 'crit' });
      }
    } catch (e2) { report(e2); }
  }

  // Advances the live world one tick: one batch, one notify, a checkpoint digest at each day roll.
  E.tickOnce = function () {
    var w = MC.store.getState();
    if (!w) return null;
    var t0 = now(), ok = true;
    try {
      MC.store.batch(function () {
        E.advance(w);
        var t = w.meta.tick;
        if (MC.time.hourOf(t) === 0 && MC.replay && typeof MC.replay.digestWorld === 'function') {
          E.checkpoints[t] = MC.replay.digestWorld(w).state;
        }
      });
    } catch (e) { ok = false; pauseWithError(e); }
    E.lastTickMs = now() - t0;
    emit();
    return ok ? w.meta.tick : null;
  };

  /* ======================= wall-clock scheduler ======================= */
  function clear() { if (timer !== null) { clearTimeout(timer); timer = null; } }
  function schedule(delay) { clear(); timer = setTimeout(fire, Math.max(0, delay)); }
  function fire() {
    timer = null;
    if (speed === 'pause' || !booted) return;
    var start = now();
    E.tickOnce();
    if (speed === 'pause') return;
    // Exactly one tick per fire; an overrun skips ahead instead of queueing.
    schedule(E.SPEEDS[speed] - (now() - start));
  }

  E.setSpeed = function (key) {
    if (!Object.prototype.hasOwnProperty.call(E.SPEEDS, key)) return speed;
    var changed = key !== speed;
    speed = key;
    clear();
    if (key !== 'pause' && booted) schedule(E.SPEEDS[key]);
    if (changed) {
      try { if (MC.uiStore && MC.uiStore.set) MC.uiStore.set({ speed: key }); } catch (e) { report(e); }
      emit();
    }
    return speed;
  };
  E.getSpeed = function () { return speed; };
  E.isBooted = function () { return booted; };

  // Advances n ticks (1..168) synchronously with a single notify; the live pace then continues.
  E.step = function (n) {
    n = Math.max(1, Math.min(24 * 7, (n | 0) || 1));
    if (!MC.store.getState()) return null;
    var last = null;
    MC.store.batch(function () {
      for (var i = 0; i < n; i++) { last = E.tickOnce(); if (last === null) break; }
    });
    return last;
  };

  /* ======================= boot / restart ======================= */
  function phaseInfo(id) {
    for (var i = 0; i < E.PHASES.length; i++) if (E.PHASES[i].id === id) return { index: i, total: E.PHASES.length, label: E.PHASES[i].label };
    return { index: -1, total: E.PHASES.length, label: id };
  }
  function tell(onPhase, id) {
    if (typeof onPhase !== 'function') return;
    try { onPhase(id, phaseInfo(id)); } catch (e) { report(e); }
  }
  function yieldThen(fn) { setTimeout(fn, 0); }

  // Generates a world in slices (yielding between phases so the boot card can paint).
  function generateWorld(seed, onPhase) {
    return new Promise(function (resolve, reject) {
      if (!(MC.data && (typeof MC.data.generateSteps === 'function' || typeof MC.data.generate === 'function'))) {
        reject(new Error('MC.data.generate missing (owner: core)'));
        return;
      }
      var finish = function (w) {
        tell(onPhase, 'agents');
        yieldThen(function () {
          try { resolve(E.prepare(w)); } catch (e) { reject(e); }
        });
      };
      if (typeof MC.data.generateSteps !== 'function') {
        tell(onPhase, 'profiles');
        yieldThen(function () { try { finish(MC.data.generate(seed)); } catch (e) { reject(e); } });
        return;
      }
      var it;
      try { it = MC.data.generateSteps(seed); } catch (e) { reject(e); return; }
      var guard = 0;
      tell(onPhase, 'profiles');
      var next = function () {
        try {
          var r = it.next() || {};
          if (r.phase) tell(onPhase, r.phase);
          if (r.done || r.world) { if (!r.world) throw new Error('The sample world generator returned nothing.'); finish(r.world); return; }
          if (++guard > 100) throw new Error('The sample world generator did not finish.');
          yieldThen(next);
        } catch (e) { reject(e); }
      };
      yieldThen(next);
    });
  }
  E.generateWorld = generateWorld;

  // Fast-forwards a freshly generated world to the real current date and hour, so the sample season
  // (Nov 7 - Dec 31, 2026, on its real calendar) reads as "today". Outside the season it stays at the start.
  E.LAST_DAY = 54; // Dec 31, 2026
  E.catchUpTarget = function (now) {
    var d = now || new Date();
    var day = MC.time.simDayOfYmd(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2));
    if (day === null || day < 0 || day > E.LAST_DAY) return 0;
    return MC.time.tickOf(day, d.getHours());
  };
  function catchUp(w, target, onPhase) {
    return new Promise(function (resolve, reject) {
      if (!(target > (w.meta.tick || 0))) return resolve(w);
      try { if (onPhase) onPhase('catchup', { index: 4, total: 5, label: 'Catching up to today' }); } catch (e) { report(e); }
      (function chunk() {
        try {
          var stop = Math.min(target, w.meta.tick + 12);
          while (w.meta.tick < stop) w = E.advance(w);
        } catch (e) { return reject(e); }
        if (w.meta.tick >= target) resolve(w); else yieldThen(chunk);
      })();
    });
  }
  E.catchUp = catchUp;

  /* ---- off-thread build: the same generate + catch-up code runs in js/core/boot-worker.js ---- */
  function coreScripts() {
    var out = [], list = document.querySelectorAll ? document.querySelectorAll('script[src]') : [];
    for (var i = 0; i < list.length; i++) {
      var src = list[i].getAttribute('src') || '';
      if (/^js\/(core|agents)\//.test(src)) out.push(src);
    }
    return out;
  }
  function canUseWorker() {
    try {
      return typeof Worker === 'function' && typeof document !== 'undefined' && /^https?:$/.test(location.protocol) && coreScripts().length > 0;
    } catch (e) { return false; }
  }
  function buildInWorker(seed, target, onPhase) {
    return new Promise(function (resolve, reject) {
      var wk;
      try { wk = new Worker('js/core/boot-worker.js' + (MC.BUILD ? '?v=' + MC.BUILD : '')); } catch (e) { reject(e); return; }
      var done = false;
      function end(fn, v) { if (done) return; done = true; try { wk.terminate(); } catch (e) { /* already gone */ } fn(v); }
      wk.onmessage = function (ev) {
        var m = ev.data || {};
        if (m.type === 'phase') tell(onPhase, m.id);
        else if (m.type === 'done') end(resolve, m.world);
        else if (m.type === 'error') end(reject, new Error(m.message || 'The sample world could not be built.'));
      };
      wk.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); end(reject, new Error('worker failed to start')); };
      wk.postMessage({ type: 'build', seed: seed, target: target, scripts: coreScripts() });
    });
  }
  // Finished world at the catch-up target. Uses a worker when possible, else (or if it fails) the in-thread path.
  E.build = function (seed, opts) {
    opts = opts || {};
    var target = opts.target !== undefined ? opts.target : (opts.catchUp === false ? 0 : E.catchUpTarget(opts.now));
    // seeded missions are dated relative to where the world will be caught up to (narration only)
    if (MC.data) MC.data.seedTarget = target;
    function inThread() {
      return generateWorld(seed, opts.onPhase).then(function (w) { return target ? catchUp(w, target, opts.onPhase) : w; });
    }
    if (opts.worker === false || !canUseWorker()) return inThread();
    return buildInWorker(seed, target, opts.onPhase).then(function (w) {
      w = E.prepare(w);
      E.workerBuilds = (E.workerBuilds || 0) + 1;
      return w;
    }, function (e) { report(e); return inThread(); });
  };

  E.boot = function (opts) {
    opts = opts || {};
    if (bootPromise) return bootPromise;
    var seed = opts.seed === undefined ? MC.SEED : opts.seed;
    // Pin the display calendar before any text is generated (catch-up writes feed and insight text).
    try { if (MC.time && MC.time.anchorDisplay) MC.time.anchorDisplay('2026-11-07', 0); } catch (e) { report(e); }
    bootPromise = E.build(seed, opts).then(function (w) {
      E.checkpoints = {};
      // Display dates are the season's real calendar (Black Friday = Fri, Nov 27, 2026), so digests never depend on the boot date.
      try { if (MC.time && MC.time.anchorDisplay) MC.time.anchorDisplay('2026-11-07', 0); } catch (e) { report(e); }
      MC.store.init(w);
      booted = true;
      E.setSpeed(opts.speed && E.SPEEDS[opts.speed] !== undefined ? opts.speed : E.DEFAULT_SPEED);
      emit();
      return w;
    }, function (e) { bootPromise = null; throw e; });
    return bootPromise;
  };

  function resetFocus(w) {
    var UI = MC.uiStore;
    if (!UI || !UI.getState) return;
    var s = UI.getState(), f = assign({}, s.focus || {}), changed = false;
    function fix(view, key, exists) {
      var v = f[view];
      if (v && v[key] !== null && v[key] !== undefined && !exists(v[key])) { var o = assign({}, v); o[key] = null; f[view] = o; changed = true; }
    }
    fix('campaigns', 'id', function (id) { return !!w.campaigns.byId[id]; });
    fix('content', 'variantId', function (id) { return !!w.variants.byId[id]; });
    fix('audiences', 'segmentId', function (id) { return !!w.segments.byId[id]; });
    fix('audiences', 'profileIdx', function (i) { return i >= 0 && i < w.profiles.n; });
    fix('agents', 'auditId', function () { return false; });
    if (f.campaigns && f.campaigns.mode === 'detail' && !f.campaigns.id) { f.campaigns = assign({}, f.campaigns, { mode: 'board' }); changed = true; }
    var patch = { verifying: null };
    if (changed) patch.focus = f;
    UI.set(patch);
  }

  // Pauses, regenerates the world (clearing the log, checkpoints and toasts) and resumes at the default pace.
  E.restart = function (seed, onPhase) {
    E.setSpeed('pause');
    var s = seed === undefined || seed === null ? MC.SEED : seed;
    return E.build(s, { onPhase: onPhase }).then(function (w) {
      E.checkpoints = {};
      E.lastError = null;
      try { if (MC.uiStore && MC.uiStore.clearToasts) MC.uiStore.clearToasts(); } catch (e) { report(e); }
      MC.store.init(w);
      booted = true;
      resetFocus(w);
      E.setSpeed(E.DEFAULT_SPEED);
      emit();
      return w;
    });
  };
})();
