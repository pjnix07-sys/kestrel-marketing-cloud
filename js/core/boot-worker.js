/* Marketing Cloud - boot worker. Builds the sample world and catches it up to today off the main thread.
   It loads the same core and agent scripts as the page (shimming window = self) and runs the same
   MC.engine code paths, so the world it posts back is identical to the in-thread build. */
'use strict';
self.window = self;
self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type !== 'build') return;
  try {
    for (var i = 0; i < m.scripts.length; i++) {
      if (!/^js\/(core|agents)\/[a-z-]+\.js(\?v=[\w.-]+)?$/.test(m.scripts[i])) throw new Error('Unexpected script ' + m.scripts[i]);
      importScripts('../../' + m.scripts[i]);
    }
    var MC = self.MC, E = MC.engine;
    try { MC.time.anchorDisplay('2026-11-07', 0); } catch (e) { /* display only */ }
    E.build(m.seed, {
      worker: false,
      target: m.target,
      onPhase: function (id) { self.postMessage({ type: 'phase', id: id }); }
    }).then(function (w) {
      // Underscore-key caches travel too: world._organic is a per-day table whose contents depend on when it was first built,
      // so rebuilding it after the transfer would change the day's results.
      self.postMessage({ type: 'done', world: w });
    }, function (e) { self.postMessage({ type: 'error', message: String((e && e.message) || e) }); });
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e && e.message) || e) });
  }
};
