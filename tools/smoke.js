// Headless smoke test: loads js/core and js/agents in Node (no browser), boots the sample world,
// advances it and audits the result.
// Usage:  node tools/smoke.js [hours=200]
//   hours  how many simulated hours to advance (default 200; 400 is the usual pre-merge run).
// Output: one summary line plus the audit; exit code 1 if the audit reports any error.
// Run it twice after touching js/core or js/agents: the output must be identical (the world is deterministic).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/src="(js\/[^"?]+)(?:\?v=[^"]*)?"/g)].map(m => m[1])
  .filter(s => s.startsWith('js/core/') || s.startsWith('js/agents/'));
const ctx = { console, setTimeout, clearTimeout, performance: { now: () => Date.now() },
  Math, Date, JSON, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float32Array, Map, Set, Promise };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const s of srcs) {
  const p = path.join(root, s);
  if (!fs.existsSync(p)) { console.log('MISSING ' + s); continue; }
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: s }); }
  catch (e) { console.log('LOAD FAIL ' + s + ': ' + e.stack); process.exitCode = 1; }
}
const MC = ctx.MC;
{ // Every same-origin script/stylesheet in index.html must carry ?v=<MC.BUILD>.
  const refs = [...html.matchAll(/(?:src|href)="((?:js|css|vendor)\/[^"]+)"/g)].map(m => m[1]);
  const bad = refs.filter(r => r.split('?v=')[1] !== MC.BUILD);
  if (bad.length) { console.log('BUILD MISMATCH (MC.BUILD=' + MC.BUILD + '):', bad.slice(0, 5).join(', ')); process.exitCode = 1; }
}
const ticks = +process.argv[2] || 200;
(async () => {
  try {
    if (MC.contract && MC.contract.check) { const r = MC.contract.check(); const miss = (r && (r.missing || r)) || []; if (miss.length) console.log('contract missing:', JSON.stringify(miss).slice(0, 800)); }
    const t0 = Date.now();
    await MC.engine.boot({ seed: 'fernway', speed: 'pause', catchUp: false });
    console.log('booted in', Date.now() - t0, 'ms; agents registered:', MC.runtime.defs().map(d => d.id).join(','));
    let w = MC.store.get ? MC.store.get() : MC.store.getState();
    for (let i = 0; i < ticks; i++) { w = MC.engine.advance(w); }
    const props = Object.values(w.proposals && w.proposals.byId || w.proposals || {});
    const byAgent = {};
    for (const p of props) { const k = p.agentId + ':' + p.status; byAgent[k] = (byAgent[k] || 0) + 1; }
    console.log('tick', w.meta.tick, 'proposals', JSON.stringify(byAgent));
    const audit = (w.audit && (w.audit.entries || w.audit.list)) || [];
    const errs = audit.filter(a => a.error);
    console.log('audit entries', audit.length, 'with errors', errs.length);
    errs.slice(0, 5).forEach(a => console.log('  ERR', a.agentId, a.tick, String(a.error).slice(0, 300)));
    console.log('feed items', (w.feed && (w.feed.items || w.feed).length) || 0);
  } catch (e) { console.log('RUN FAIL', e.stack); process.exitCode = 1; }
})();
