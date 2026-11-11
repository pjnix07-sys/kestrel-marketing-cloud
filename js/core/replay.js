/* Kestrel Marketing Cloud - MC.replay and MC.dev.selfTest. Digests the world in canonical form,
   replays seed + tick-stamped user action log headlessly (chunked, never blocking the page) and
   verifies that the replay reaches the same state and audit chain as the live session. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var R = MC.replay = MC.replay || {};
  MC.dev = MC.dev || {};

  var assign = Object.assign;
  var PART_KEYS = ['profiles', 'latent', 'metrics', 'enroll', 'entities', 'log'];
  R.PART_KEYS = PART_KEYS;

  function U() { return MC.util; }
  function now() { return MC.util.now(); }
  function report(e) { if (window.console && console.error) console.error(e); }

  /* ======================= digests (§10.11) ======================= */
  R.digestWorld = function (w) {
    var d = U().digest;
    var parts = {
      profiles: d(w.profiles), latent: d(w.latent), metrics: d(w.metrics), enroll: d(w.enroll),
      entities: d({ meta: w.meta, seq: w.seq, catalog: w.catalog, modelState: w.modelState, segments: w.segments,
        campaigns: w.campaigns, variants: w.variants, agents: w.agents, proposals: w.proposals, feed: w.feed,
        insights: w.insights, guardrails: w.guardrails }),
      log: d(w.log)
    };
    var state = U().hex8(U().fnv1a(PART_KEYS.map(function (k) { return parts[k]; }).join('|')));
    return { state: state, audit: (w.audit && w.audit.head) || '00000000', parts: parts };
  };

  /* ======================= replay ======================= */
  // Fresh world from seed; for t = 1..toTick apply log entries stamped t−1, then advance; finally apply toTick.
  R.run = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var w;
      try { w = MC.engine.prepare(MC.data.generate(opts.seed === undefined ? MC.SEED : opts.seed)); }
      catch (e) { reject(e); return; }
      var log = opts.log || [], N = Math.max(0, opts.toTick | 0), chunk = Math.max(1, opts.chunk || 20);
      var cps = opts.checkpoints || null, i = 0, first = null, diverged = null, t = 1;
      function apply(stamp) {
        while (i < log.length && log[i].tick <= stamp) {
          var r = MC.catalog.dispatchUser(w, { type: log[i].type, payload: log[i].payload });
          if (!r.ok && diverged === null) diverged = { tick: stamp, seq: log[i].seq, type: log[i].type, error: r.error };
          i++;
        }
      }
      function loop() {
        try {
          var end = Math.min(N, t + chunk - 1);
          for (; t <= end; t++) {
            apply(t - 1);
            MC.engine.advance(w);
            if (cps && first === null && MC.time.hourOf(t) === 0 && cps[t] !== undefined && R.digestWorld(w).state !== cps[t]) first = t;
          }
          if (typeof opts.onProgress === 'function') { try { opts.onProgress(Math.min(t - 1, N), N); } catch (e) { report(e); } }
          if (t <= N) { setTimeout(loop, 0); return; }
          apply(N);
          w._firstMismatch = first;
          w._diverged = diverged;
          resolve(w);
        } catch (e) { reject(e); }
      }
      loop();
    });
  };

  function divergence(liveEntries, rep, liveDig, repDig, first, N) {
    var upTo = first !== null && first !== undefined ? first : N;
    var L = {}, P = {}, ids = {};
    liveEntries.forEach(function (e) { if (e.tick <= upTo) { L[e.id] = e; ids[e.id] = e.tick; } });
    ((rep.audit && rep.audit.entries) || []).forEach(function (e) { if (e.tick <= upTo) { P[e.id] = e; ids[e.id] = e.tick; } });
    var order = Object.keys(ids).sort(function (a, b) { return (ids[a] - ids[b]) || (a < b ? -1 : (a > b ? 1 : 0)); });
    for (var k = 0; k < order.length; k++) {
      var id = order[k], l = L[id], r = P[id];
      if (!l || !r || l.inDigest !== r.inDigest || l.outDigest !== r.outDigest) {
        var src = l || r;
        return { tick: src.tick, agentId: src.agentId, auditId: id, live: l ? l.outDigest : null, replay: r ? r.outDigest : null,
          checkpoint: first === undefined ? null : first };
      }
    }
    for (var j = 0; j < PART_KEYS.length; j++) {
      var pk = PART_KEYS[j];
      if (liveDig.parts[pk] !== repDig.parts[pk]) return { tick: upTo, part: pk, live: liveDig.parts[pk], replay: repDig.parts[pk], checkpoint: first === undefined ? null : first };
    }
    return { tick: upTo, part: 'audit', live: liveDig.audit, replay: repDig.audit, checkpoint: first === undefined ? null : first };
  }

  function setVerifying(v) { try { if (MC.uiStore && MC.uiStore.set) MC.uiStore.set({ verifying: v }); } catch (e) { report(e); } }

  var running = null;
  R.lastResult = null;
  // Pauses the clock, replays the live log from the seed and compares state + audit digests.
  R.verify = function (opts) {
    opts = opts || {};
    if (running) return running;
    var live = MC.store.getState();
    if (!live) return Promise.reject(new Error('The sample world is still loading.'));
    var prevSpeed = MC.engine.getSpeed();
    MC.engine.setSpeed('pause');
    var N = live.meta.tick, t0 = now();
    setVerifying({ done: 0, total: N });
    var log = (live.log || []).slice();
    var liveDig = R.digestWorld(live);
    var liveEntries = ((live.audit && live.audit.entries) || []).slice();
    var cps = assign({}, MC.engine.checkpoints || {});
    function finish() {
      running = null;
      setVerifying(null);
      if (prevSpeed !== 'pause' && MC.engine.getSpeed() === 'pause') MC.engine.setSpeed(prevSpeed);
    }
    running = R.run({
      seed: live.meta.seed, log: log, toTick: N, checkpoints: cps, chunk: opts.chunk || 20,
      onProgress: function (done, total) {
        setVerifying({ done: done, total: total });
        if (typeof opts.onProgress === 'function') opts.onProgress(done, total);
      }
    }).then(function (w) {
      var repDig = R.digestWorld(w);
      var res = { match: liveDig.state === repDig.state && liveDig.audit === repDig.audit, tick: N, ms: now() - t0,
        live: liveDig, replay: repDig, actions: log.length, checkpoints: Object.keys(cps).length };
      if (!res.match) res.firstDivergence = divergence(liveEntries, w, liveDig, repDig, w._firstMismatch, N);
      if (w._diverged) res.replayError = w._diverged;
      R.lastResult = res;
      finish();
      return res;
    }, function (e) { finish(); throw e; });
    return running;
  };

  /* ======================= self test (§10.11) ======================= */
  function wait() { return new Promise(function (res) { setTimeout(res, 0); }); }
  function ms(x) { return (Math.round(x * 10) / 10) + ' ms'; }
  function row(id, label, status, value, detail) { return { id: id, label: label, status: status, ok: status !== 'fail', value: value, detail: detail || '' }; }

  // Advances w by n ticks in chunks (yielding to the page); resolves with per-tick timings.
  function advanceN(w, n, chunk) {
    var times = [], done = 0;
    return new Promise(function (resolve, reject) {
      function loop() {
        try {
          var end = Math.min(n, done + (chunk || 24));
          for (; done < end; done++) { var t0 = now(); MC.engine.advance(w); times.push(now() - t0); }
          if (done < n) { setTimeout(loop, 0); return; }
          resolve(times);
        } catch (e) { reject(e); }
      }
      loop();
    });
  }

  var GOAL_IDX = { revenue: 'REV', conversions: 'CONV', reactivation: 'REACT', engagement: 'CLICK', launch: 'CONV' };
  function attainment(w) {
    var pcts = [], rev = 0, days = w.metrics.days;
    w.campaigns.order.forEach(function (cid) {
      var c = w.campaigns.byId[cid];
      if (!c || c.status === 'draft' || !(c.goal && c.goal.target > 0)) return;
      if (c.endTick <= 0 || c.startTick > w.meta.tick) return;
      var k = MC.F[GOAL_IDX[c.goal.type] || 'REV'], v = 0;
      for (var i = 0; i < days.length; i++) {
        var cd = days[i].c && days[i].c[cid];
        if (cd && days[i].day >= 0) v += cd.tot[k];
      }
      pcts.push(v / c.goal.target);
    });
    for (var j = 0; j < days.length; j++) if (days[j].day >= 0) rev += days[j].tot[MC.F.REV];
    var mean = pcts.length ? pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length : 0;
    return { mean: mean, revenue: rev, campaigns: pcts.length };
  }

  function bannedScan() {
    var tokens = ['Math.' + 'random', 'Date.' + 'now', 'new ' + 'Date()', 'performance.' + 'now', 'crypto.' + 'getRandomValues', 'Int' + 'l.', 'toLocale' + 'String'];
    var spaces = ['util', 'time', 'rng', 'catalog', 'models', 'segments', 'copy', 'data', 'guardrails', 'sim', 'select', 'runtime'];
    var hits = [], scanned = 0;
    function check(name, fn) {
      if (typeof fn !== 'function') return;
      var src;
      try { src = Function.prototype.toString.call(fn); } catch (e) { return; }
      scanned++;
      for (var i = 0; i < tokens.length; i++) if (src.indexOf(tokens[i]) >= 0) hits.push(name + ' uses ' + tokens[i]);
    }
    spaces.forEach(function (ns) {
      var o = MC[ns];
      if (!o) return;
      Object.keys(o).sort().forEach(function (k) {
        if (ns === 'util' && k === 'now') return;
        check('MC.' + ns + '.' + k, o[k]);
      });
    });
    if (MC.runtime && typeof MC.runtime.defs === 'function') {
      MC.runtime.defs().forEach(function (def) {
        Object.keys(def).sort().forEach(function (k) { check('agent ' + def.id + '.' + k, def[k]); });
      });
    }
    return { hits: hits, scanned: scanned };
  }

  // Diagnostics on fresh copies of the world (never the live one). Resolves with result rows.
  MC.dev.selfTest = function (opts) {
    opts = opts || {};
    var seed = opts.seed === undefined ? MC.SEED : opts.seed;
    var rows = [], w1, w2, d0;
    function progress(label) { if (typeof opts.onProgress === 'function') { try { opts.onProgress(label, rows.slice()); } catch (e) { report(e); } } }
    function guard(id, label, fn) {
      return Promise.resolve().then(fn).catch(function (e) { report(e); rows.push(row(id, label, 'fail', 'error', String(e && e.message ? e.message : e))); });
    }
    return wait().then(function () {
      return guard('generate', 'Generate the sample world', function () {
        var t0 = now();
        w1 = MC.engine.prepare(MC.data.generate(seed));
        var dt = now() - t0;
        d0 = R.digestWorld(w1);
        rows.push(row('generate', 'Generate the sample world', dt < 300 ? 'pass' : 'warn', ms(dt), 'Budget 300 ms for 6,000 profiles and 60 days of history.'));
      });
    }).then(wait).then(function () {
      progress('segments');
      return guard('segments', 'Evaluate a segment', function () {
        var id = w1.segments.order[0], rule = id ? w1.segments.byId[id].rule : { op: 'all', items: [] };
        var n = 10, t0 = now(), count = 0;
        for (var k = 0; k < n; k++) count = MC.segments.evaluate(w1, rule).count;
        var dt = (now() - t0) / n;
        rows.push(row('segments', 'Evaluate a segment', dt < 3 ? 'pass' : (dt < 10 ? 'warn' : 'fail'), ms(dt), (id ? w1.segments.byId[id].name : 'Everyone') + ': ' + MC.fmt.num(count) + ' people. Budget 3 ms typical, 10 ms max.'));
      });
    }).then(function () {
      progress('ticks');
      return guard('ticks', 'Advance 48 ticks', function () {
        return advanceN(w1, 48).then(function (times) {
          var mean = times.reduce(function (a, b) { return a + b; }, 0) / times.length, max = Math.max.apply(null, times);
          rows.push(row('ticks', 'Advance 48 ticks', mean < 8 && max < 40 ? 'pass' : 'warn', ms(mean) + ' mean · ' + ms(max) + ' max', 'Budget 8 ms per tick, 40 ms on a day roll.'));
        });
      });
    }).then(function () {
      progress('determinism');
      return guard('determinism', 'Determinism', function () {
        w2 = MC.engine.prepare(MC.data.generate(seed));
        var g2 = R.digestWorld(w2);
        var genOk = !!d0 && g2.state === d0.state;
        return advanceN(w2, 48).then(function () {
          var a = R.digestWorld(w1), b = R.digestWorld(w2);
          var runOk = a.state === b.state && a.audit === b.audit;
          rows.push(row('determinism', 'Determinism', genOk && runOk ? 'pass' : 'fail', genOk && runOk ? 'Identical digests' : 'Digests differ',
            'Generate twice: ' + (genOk ? 'same' : 'different') + ' (' + g2.state + '). 48 ticks twice: ' + (runOk ? 'same' : 'different') + ' (' + a.state + ' / ' + a.audit + ').'));
        });
      });
    }).then(wait).then(function () {
      progress('scan');
      return guard('scan', 'No clocks or unseeded randomness in logic', function () {
        var s = bannedScan();
        rows.push(row('scan', 'No clocks or unseeded randomness in logic', s.hits.length ? 'fail' : 'pass', s.hits.length ? s.hits.length + ' found' : 'Clean',
          s.hits.length ? s.hits.slice(0, 8).join('; ') : 'Scanned ' + s.scanned + ' functions across core and agents.'));
      });
    }).then(function () {
      return guard('contract', 'Contract check', function () {
        var miss = (MC.contract && MC.contract.check ? MC.contract.check().missing : []) || [];
        rows.push(row('contract', 'Contract check', miss.length ? 'warn' : 'pass', miss.length ? miss.length + ' missing' : 'Complete',
          miss.length ? miss.slice(0, 12).join(', ') + (miss.length > 12 ? '…' : '') : 'Every required API is present and all eight agents are registered.'));
      });
    }).then(function () {
      if (opts.skipGoals) return null;
      progress('goals');
      return guard('goals', '14-day goal attainment', function () {
        var off = MC.engine.prepare(MC.data.generate(seed)), on = MC.engine.prepare(MC.data.generate(seed));
        var byId = assign({}, off.agents.byId);
        Object.keys(byId).forEach(function (id) { byId[id] = assign({}, byId[id], { autonomy: 'off' }); });
        off.agents = assign({}, off.agents, { byId: byId });
        return advanceN(off, 14 * 24, 24).then(function () { return advanceN(on, 14 * 24, 24); }).then(function () {
          var a = attainment(off), b = attainment(on), diff = b.mean - a.mean;
          rows.push(row('goals', '14-day goal attainment', diff >= 0 ? 'pass' : 'warn',
            'Agents off ' + MC.fmt.pct(a.mean, 0) + ' · default ' + MC.fmt.pct(b.mean, 0),
            'Mean share of goal reached across ' + b.campaigns + ' campaigns after 14 sim days; revenue ' + MC.fmt.money(a.revenue, { compact: true }) + ' vs ' + MC.fmt.money(b.revenue, { compact: true }) + '.'));
        });
      });
    }).then(function () { progress('done'); return rows; });
  };
})();
