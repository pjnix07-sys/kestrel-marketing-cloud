// Mission engine tests (Node, loads like tools/smoke.js). Usage: node tools/missions-test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/src="(js\/[^"?]+)(?:\?v=[^"]*)?"/g)].map(m => m[1]).filter(s => s.startsWith('js/core/') || s.startsWith('js/agents/') || s.startsWith('js/ai/'));
function load() {
  const ctx = { console, setTimeout, clearTimeout, performance: { now: () => Date.now() }, Math, Date, JSON, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float32Array, Map, Set, Promise };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const s of srcs) vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), ctx, { filename: s });
  return ctx.MC;
}
let fails = 0, passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { fails++; console.log('FAIL', name, detail === undefined ? '' : detail); } }
async function boot() {
  const MC = load();
  await MC.engine.boot({ seed: 'fernway', speed: 'pause', catchUp: false });
  return MC;
}
function adv(MC, n) { let w = MC.store.getState(); for (let i = 0; i < n; i++) MC.engine.advance(w); return w; }
const mission = (MC, id) => MC.store.getState().missions.byId[id];

(async () => {
  let MC = await boot(), w = MC.store.getState();
  // ---- seeds
  check('seed count', w.missions.order.length === 2);
  const s1 = mission(MC, 'm-lhw'), s2 = mission(MC, 'm-bfe');
  check('seed1 waiting with one ask', s1.status === 'waiting' && s1.asks.filter(a => a.status === 'open').length === 1);
  check('seed2 monitoring with replan beat', s2.phase === 'monitoring' && s2.log.some(b => b.kind === 'replan'));
  check('seed artifacts linked', s1.artifacts.some(a => a.id === 'c-lhw') && s2.artifacts.some(a => a.id === 'c-bfe'));

  // ---- parser
  const day = d => MC.time.simDayOfYmd(d);
  const P = t => MC.lead.parse(t, w);
  let p = P('Win back 400 lapsed hikers before Dec 15 without discounting more than 15%');
  check('p1', p.template === 'winback' && p.metric === 'reactivations' && p.target === 400 && p.by === day('2026-12-14') && p.constraints.some(c => c.kind === 'maxDiscountPct' && c.value === 15), JSON.stringify(p));
  p = P('Hit $48k on Black Friday Early Access');
  check('p2', p.template === 'event' && p.metric === 'revenue' && p.target === 48000 && p.event && p.event.day === 20, JSON.stringify(p));
  p = P('Get to $20,000 in sales by Friday, no SMS');
  check('p3', p.metric === 'revenue' && p.target === 20000 && p.constraints.some(c => c.kind === 'excludeChannel' && c.value === 'sms') && p.byGiven, JSON.stringify(p));
  p = P('Launch the Summit Insulated Jacket and drive 250 orders by Dec 10, spend under $3k');
  check('p4', p.template === 'launch' && p.target === 250 && p.by === day('2026-12-10') && p.constraints.some(c => c.kind === 'maxSpend' && c.value === 3000), JSON.stringify(p));
  p = P('Reactivate gift givers in 2 weeks with no discounts');
  check('p5', p.template === 'winback' && p.audience.segmentId === 's-gift' && p.constraints.some(c => c.kind === 'maxDiscountPct' && c.value === 0) && p.by === w.meta.tick / 24 + 14, JSON.stringify(p));
  p = P('Protect the list: keep unsubscribes under 40 through the end of the month, max 2 emails a week');
  check('p6', p.template === 'protect' && p.metric === 'unsubs' && p.target === 40 && p.constraints.some(c => c.kind === 'maxSendsPerWeek' && c.value === 2), JSON.stringify(p));
  p = P('Grow Summit & Peak members by 20% by Dec 20');
  check('p7', p.template === 'grow' && p.growthPct === 20 && p.by === day('2026-12-20'), JSON.stringify(p));
  p = P('Get 300 new sign-ups before Cyber Monday');
  check('p8', p.template === 'grow' && p.target === 300 && p.by === 22, JSON.stringify(p));
  p = P('Win back lapsed customers');
  check('p9', p.template === 'winback' && p.missing.indexOf('target') >= 0 && p.missing.indexOf('deadline') >= 0, JSON.stringify(p));
  p = P('Make the holidays great');
  check('p10', p.missing.indexOf('goal') >= 0, JSON.stringify(p));
  p = P('Sell $5k of trail runner gear by next week, email only');
  check('p11', p.target === 5000 && p.audience.segmentId === 's-runners' && ['sms', 'push', 'social', 'web'].every(c => p.constraints.some(x => x.value === c)) && p.by === w.meta.tick / 24 + 7, JSON.stringify(p));
  p = P('Drive 120 orders from car campers within 10 days, skip push and ads, discount at most 10%');
  check('p12', p.target === 120 && p.audience.segmentId === 's-campers' && p.constraints.some(c => c.value === 'push') && p.constraints.some(c => c.value === 'social') && p.constraints.some(c => c.kind === 'maxDiscountPct' && c.value === 10), JSON.stringify(p));
  p = P('Reach $30k by Dec 1 and keep the discount under 20% off, no more than 3 sends per week');
  check('p13', p.target === 30000 && p.constraints.some(c => c.kind === 'maxSendsPerWeek' && c.value === 3) && p.constraints.some(c => c.kind === 'maxDiscountPct' && c.value === 20), JSON.stringify(p));

  // ---- plan creation + full execution to monitoring (immediate, no waiting on ticks)
  let r = MC.missions.createSync('Win back 400 lapsed hikers before Dec 15 without discounting more than 15%');
  check('create ok', r.ok && r.id, JSON.stringify(r));
  let m = mission(MC, r.id);
  check('executes immediately to monitoring', m.phase === 'monitoring' && m.status === 'running' && m.plan.every(s => s.status === 'done' || s.status === 'skipped'), JSON.stringify(m.plan.map(s => s.kind + ':' + s.status)));
  const cid = (m.artifacts.filter(a => a.kind === 'campaign')[0] || {}).id;
  w = MC.store.getState();
  const camp = w.campaigns.byId[cid];
  check('real draft campaign', camp && camp.status === 'draft' && camp.offer !== 'pct25');
  const vs = MC.catalog.variantsOf(w, cid);
  check('variants in review', vs.length > 0 && vs.every(v => v.review === 'in_review'));
  check('launch ask is non-blocking', m.asks.some(a => a.kind === 'launch' && a.status === 'open' && a.blocking === false));
  check('no ticks/seeds in beats', !m.log.some(b => /\b(tick|seed|simulat)/i.test(b.text)));
  adv(MC, 24 * 3);
  m = mission(MC, r.id);
  check('daily check-in beats', m.lastCheckDay !== null && m.log.some(b => b.agentId === 'analyst'));

  // ---- guardrail block -> ask -> answer
    w = MC.store.getState();
  r = MC.missions.createSync('Hit $10k in revenue by Dec 3, SMS only');
  m = mission(MC, r.id);
  const blocked = m.plan.filter(s => s.status === 'blocked')[0];
  const ask = m.asks.filter(a => a.status === 'open' && a.kind === 'guardrail')[0];
  check('guardrail blocks and asks', !!blocked && blocked.kind === 'campaign' && ask && m.status === 'waiting', JSON.stringify(m.plan.map(s => s.kind + ':' + s.status)) + ' ' + (w.guardrails && w.guardrails.maxDailySpend));
  if (ask) {
    const ar = MC.missions.answer(m.id, ask.id, ask.options[0]);
    check('answer ok', ar.ok, ar.error);
    m = mission(MC, m.id);
    check('continues after answer', m.phase === 'monitoring' || m.plan.some(s => s.kind === 'campaign' && s.status === 'done'), JSON.stringify(m.plan.map(s => s.kind + ':' + s.status)));
  }
  // clarifying ask
  r = MC.missions.createSync('Win back lapsed customers');
  m = mission(MC, r.id);
  const ca = m.asks.filter(a => a.status === 'open')[0];
  check('clarifying ask from Lead', ca && ca.agentId === 'lead' && m.plan[0].status === 'blocked');
  if (ca) { MC.missions.answer(m.id, ca.id, ca.options[1]); m = mission(MC, m.id); const ca2 = m.asks.filter(a => a.status === 'open')[0]; if (ca2) MC.missions.answer(m.id, ca2.id, ca2.options[1]); m = mission(MC, m.id); check('clarified mission proceeds', m.phase === 'monitoring', m.phase + ' ' + m.status); }

  // ---- steer -> replan
  r = MC.missions.createSync('Hit $12k in revenue by Dec 8 with a Cyber Monday push');
  m = mission(MC, r.id);
  const before = m.plan.length;
  const sr = MC.missions.steer(m.id, 'no SMS and keep the discount under 10%');
  m = mission(MC, m.id);
  const c2 = w.campaigns.byId[(m.artifacts.filter(a => a.kind === 'campaign')[0] || {}).id];
  check('steer adds steps and beats', sr.ok && m.plan.length > before && m.log.some(b => b.kind === 'replan'), JSON.stringify(sr));
  check('steer constraints', m.objective.constraints.some(c => c.kind === 'excludeChannel' && c.value === 'sms') && m.objective.constraints.some(c => c.kind === 'maxDiscountPct' && c.value === 10));
  w = MC.store.getState();
  const c3 = w.campaigns.byId[c2.id];
  check('steer acts on artifacts', c3.channelPaused.sms && (MC.lead.OFFER_PCT[c3.offer] || 0) <= 10, JSON.stringify([c3.channelPaused, c3.offer]));
  MC.missions.steer(m.id, 'pause until Monday');
  check('pause', mission(MC, m.id).status === 'paused');

  // ---- selectors
  const rows = MC.select.missions(MC.store.getState());
  check('selector rows', rows.length >= 4 && rows[0].progress && rows[0].objective.text);
  check('selector detail', MC.select.mission(MC.store.getState(), 'm-lhw').beats.length > 0 && MC.select.missionAsks(MC.store.getState()).length >= 1 && MC.select.missionAgents(MC.store.getState()).length === 9);

  // ---- seeded ask answer executes real extend
  MC.missions.answer('m-lhw', 'a1', mission(MC, 'm-lhw').asks[0].options[0]);
  const lhw = mission(MC, 'm-lhw');
  check('seed ask answered runs to monitoring', lhw.phase === 'monitoring', JSON.stringify(lhw.plan.map(s => s.kind + ':' + s.status)));
  adv(MC, 24 * 5);

  // ---- determinism + replay
  async function scenario() {
    const M = await boot();
    M.missions.createSync('Win back 400 lapsed hikers before Dec 15 without discounting more than 15%');
    adv(M, 30);
    M.missions.createSync('Hit $9k in revenue by Dec 5');
    M.missions.steer(M.store.getState().missions.order.slice(-1)[0], 'no push');
    adv(M, 24 * 4);
    return M;
  }
  const A = await scenario(), B = await scenario();
  const dig = M => ({ s: M.replay.digestWorld(M.store.getState()).state, m: M.util.digest(M.store.getState().missions) });
  const da = dig(A), db = dig(B);
  check('deterministic digests', da.s === db.s && da.m === db.m, JSON.stringify([da, db]));
  const live = A.store.getState();
  const rep = await A.replay.run({ seed: live.meta.seed, log: live.log.slice(), toTick: live.meta.tick });
  const dr = { s: A.replay.digestWorld(rep).state, m: A.util.digest(rep.missions) };
  check('replay equality', dr.s === da.s && dr.m === da.m, JSON.stringify([dr, da]));
  console.log(fails ? 'missions-test: ' + fails + ' FAIL, ' + passes + ' pass' : 'missions-test: all ' + passes + ' pass');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('RUN FAIL', e.stack); process.exit(1); });
