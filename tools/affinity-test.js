// Affinity tests (Node, loads like tools/smoke.js). Usage: node tools/affinity-test.js
// docs/CONSISTENCY.md section 3: per-person angle taste (hidden sim truth), the response ledger, MC.affinity.forSegment / forProfile,
// and the respondsTo:<angle> segment attribute. Proves that per-audience angle differences are recoverable from the ledger with
// intervals clear of zero for at least two audiences, that the estimates agree with the hidden truth, that respondsTo segments select
// the right people, determinism, and that November stays calibrated with agents off.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/src="(js\/[^"?]+)(?:\?v=[^"]*)?"/g)].map(m => m[1]).filter(s => s.startsWith('js/core/') || s.startsWith('js/agents/'));
function load() {
  const ctx = { console, setTimeout, clearTimeout, performance: { now: () => Date.now() }, Math, Date, JSON, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Int16Array, Float32Array, Map, Set, Promise };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const s of srcs) vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), ctx, { filename: s });
  ctx.MC.time.anchorDisplay('2026-11-07', 0);
  return ctx.MC;
}
let fails = 0, passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { fails++; console.log('FAIL', name, detail === undefined ? '' : detail); } }
function world(MC, ticks, agentsOff) {
  const w = MC.engine.prepare(MC.data.generate('fernway'));
  if (agentsOff) {
    const by = Object.assign({}, w.agents.byId);
    Object.keys(by).forEach(id => by[id] = Object.assign({}, by[id], { autonomy: 'off' }));
    w.agents = Object.assign({}, w.agents, { byId: by });
  }
  for (let i = 0; i < ticks; i++) MC.engine.advance(w);
  return w;
}
function digestLedger(w) {
  let h = 2166136261;
  const mix = a => { for (let i = 0; i < a.length; i += 7) h = Math.imul(h ^ (a[i] * 1000 | 0), 16777619) >>> 0; };
  const led = w.content.led; mix(led.exp); mix(led.opn); mix(led.clk); mix(led.ord); mix(w.latent.profiles.taste);
  return h;
}

(async () => {
  const MC = load(), AF = MC.affinity;
  const w = world(MC, 500, true), n = w.profiles.n;
  const T = AF.tasteOf(w), led = w.content.led;

  /* ---- taste and ledger ---- */
  check('taste is stored per person and angle', T && T.length === n * 5);
  let mean = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) for (let a = 0; a < 5; a++) mean[a] += T[i * 5 + a] / n;
  check('taste varies between people', (() => { let s = 0, s2 = 0; for (let i = 0; i < n; i++) { const x = T[i * 5]; s += x; s2 += x * x; } return Math.sqrt(s2 / n - (s / n) ** 2) > 0.5; })());
  check('trail runners like trail-season content more than the rest', (() => {
    const runners = MC.segments.members(w, 's-runners'); let a = 0, na = 0, b = 0, nb = 0;
    for (let i = 0; i < n; i++) { if (runners[i]) { a += T[i * 5]; na++; } else { b += T[i * 5]; nb++; } }
    return a / na > b / nb + 0.3;
  })());
  let tot = 0; for (let i = 0; i < led.exp.length; i++) tot += led.exp[i];
  check('the ledger recorded deliveries', tot > 5000, tot);
  check('ledger is typed arrays per person and angle', led.exp instanceof Uint8Array && led.exp.length === n * 5 && led.clk instanceof Uint8Array && led.ord instanceof Uint8Array);

  /* ---- recoverability with intervals clear of zero ---- */
  const clear = [], bestByseg = {};
  for (const id of w.segments.order) {
    const r = AF.forSegment(w, id);
    check('forSegment shape: ' + id, r.angles.length === 5 && r.angles.every(a => 'angle' in a && 'lift' in a && 'lo' in a && 'hi' in a && 'n' in a && 'enough' in a) && Array.isArray(r.topBlocks) && Array.isArray(r.tiredBlocks));
    r.angles.forEach(a => { if (a.enough && a.clear) clear.push({ seg: id, angle: a.angle, lift: a.lift, lo: a.lo, hi: a.hi }); });
    bestByseg[id] = r.best;
  }
  const segsClear = new Set(clear.map(c => c.seg));
  check('angle differences are clear of zero for at least two audiences', segsClear.size >= 2, JSON.stringify(clear));
  check('some audience\'s best angle differs from another\'s', new Set(Object.values(bestByseg).filter(Boolean)).size >= 2, JSON.stringify(bestByseg));
  // agreement with hidden truth: taste among the audience's actual recipients of the angle vs of its other angles (exposure-weighted)
  const sign = [];
  for (const c of clear) {
    const bits = MC.segments.members(w, c.seg), a = AF.angleIndex(c.angle); let ta = 0, ea = 0, to = 0, eo = 0;
    for (let i = 0; i < n; i++) if (bits[i]) for (let b = 0; b < 5; b++) { const e = led.exp[i * 5 + b], t = T[i * 5 + b]; if (b === a) { ta += e * t; ea += e; } else { to += e * t; eo += e; } }
    sign.push({ c, truth: ta / ea - to / eo });
  }
  const agree = sign.filter(s => (s.c.lift > 0) === (s.truth > 0)).length;
  check('clear estimates point the same way as the hidden taste', agree >= Math.ceil(sign.length * 0.7), JSON.stringify(sign.map(s => [s.c.seg, s.c.angle, +s.c.lift.toFixed(2), +s.truth.toFixed(2)])));
  const runners = AF.forSegment(w, 's-runners'), loyal = AF.forSegment(w, 's-loyal');
  const row = (r, a) => r.angles.filter(x => x.angle === a)[0];
  check('trail runners: trail-season clearly above their other angles', row(runners, 'trail-season').clear && row(runners, 'trail-season').lo > 0, JSON.stringify(row(runners, 'trail-season')));
  check('summit and peak members: practical clearly above their other angles', row(loyal, 'utility').clear && row(loyal, 'utility').lo > 0, JSON.stringify(row(loyal, 'utility')));
  check('thin angles say so instead of guessing', row(runners, 'gifting').enough === false && !!row(runners, 'gifting').reason);

  /* ---- respondsTo ---- */
  for (const ang of AF.ANGLES) {
    const bits = AF.respondsBits(w, ang), a = AF.angleIndex(ang); let m = 0, nm = 0, cm = 0, cn = 0;
    for (let i = 0; i < n; i++) { if (bits[i]) { m += T[i * 5 + a]; cm++; } else { nm += T[i * 5 + a]; cn++; } }
    if (ang === 'gifting') { check('gifting has no responders before December', cm === 0); continue; }
    if (ang === 'urgency' || ang === 'warmth') { check('respondsTo:' + ang + ' selects some people', cm > 0 && cm < n); continue; }
    check('respondsTo:' + ang + ' members have clearly higher taste', cm > 50 && m / cm > nm / cn + 0.25, [cm, (m / cm).toFixed(2), (nm / cn).toFixed(2)].join(' '));
  }
  const parsed = MC.segments.parse('people who respond to trail-season content', w);
  check('parser understands "respond to trail-season content"', parsed.rule.items.length === 1 && parsed.rule.items[0].attr === 'respondsTo:trail-season', JSON.stringify(parsed.rule));
  const rule = { op: 'all', items: [{ attr: 'respondsTo:trail-season', cmp: 'is', value: true }] };
  check('respondsTo rule validates', MC.segments.validate(rule).length === 0, MC.segments.validate(rule).join());
  check('respondsTo label', MC.segments.condLabel(rule.items[0]) === 'Responds to trail-season content', MC.segments.condLabel(rule.items[0]));
  const ev = MC.segments.evaluate(w, rule), direct = AF.respondsBits(w, 'trail-season');
  let dc = 0; for (let i = 0; i < n; i++) dc += direct[i];
  check('segment evaluation equals the responder set', ev.count === dc && dc > 0, ev.count + ' vs ' + dc);
  check('ATTRS lists a Responds to condition per angle', AF.ANGLES.every(a => MC.segments.attr('respondsTo:' + a) && MC.segments.attr('respondsTo:' + a).group === 'Content'));
  const not = MC.segments.evaluate(w, { op: 'all', items: [{ attr: 'respondsTo:trail-season', cmp: 'is', value: false }] });
  check('"does not respond" is the complement', ev.count + not.count === n);

  /* ---- profile ---- */
  let pi = -1; for (let i = 0; i < n && pi < 0; i++) { let s = 0; for (let a = 0; a < 5; a++) s += led.exp[i * 5 + a]; if (s >= 3 && w.profiles.consent[i] & 1) pi = i; }
  const pr = AF.forProfile(w, pi);
  check('forProfile shape', Array.isArray(pr.history) && pr.history.length > 0 && pr.history.every(x => 'blockId' in x && 'seen' in x && 'clicked' in x && 'ordered' in x && 'lastTick' in x) && Array.isArray(pr.fatigue) && 'bestAngle' in pr, JSON.stringify(pr).slice(0, 300));
  check('profile history seen matches block exposures', pr.history.every(x => x.seen === w.content.exp[x.blockId][pi]));
  check('fatigue lists exposures per block', pr.fatigue.length === pr.history.length && pr.fatigue.every(f => f.exposures > 0));
  check('forProfile out of range is empty', AF.forProfile(w, -1).history.length === 0);

  /* ---- determinism ---- */
  const w2 = world(MC, 500, true);
  check('two runs produce the same ledger and taste', digestLedger(w) === digestLedger(w2));
  const MC3 = load(); const w3 = world(MC3, 200, false), w4 = world(load(), 200, false);
  check('with agents on the ledger is identical too', digestLedger(w3) === digestLedger(w4));

  /* ---- calibration: November with agents off ---- */
  {
    const m = MC.time.monthOf(0), c = world(MC, 0, true);
    while (c.meta.tick < (m.toDay + 1) * 24) MC.engine.advance(c);
    let rev = 0; for (const d of c.metrics.days) if (d.day >= m.fromDay && d.day <= m.toDay) rev += d.tot[MC.F.REV];
    const goal = c.meta.monthGoal.byMonth['2026-11'].revenue, pct = rev / goal;
    console.log('November revenue with agents off: ' + Math.round(rev) + ' = ' + (pct * 100).toFixed(1) + '% of goal');
    check('November lands at about 90 to 95% of goal with agents off', pct >= 0.89 && pct <= 0.96, pct);
  }
  console.log('affinity-test: ' + (fails ? fails + ' FAILED, ' : 'all ') + passes + ' pass');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('RUN FAIL', e.stack); process.exit(1); });
