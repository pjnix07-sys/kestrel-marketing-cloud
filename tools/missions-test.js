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
  check('plan forms over ticks, not at once', m.plan.every(s => s.status === 'queued' || s.status === 'blocked') && m.phase !== 'monitoring');
  // §2 clock: one dependency level per tick; independent steps together
  check('world pace is one hour per 5 s', MC.engine.PACE_MS === 5000 && MC.engine.SPEEDS['1x'] === 5000);
  adv(MC, 1); m = mission(MC, r.id);
  check('level 1 (goal) claimed and run in one tick', m.plan[0].status === 'done' && m.plan[1].status === 'queued', m.plan.map(s => s.status).join());
  adv(MC, 1); m = mission(MC, r.id);
  check('level 2 (audience) next tick, not the same tick', m.plan[1].status === 'done' && m.plan[2].status === 'queued');
  adv(MC, 1); m = mission(MC, r.id);
  check('level 3 (campaign)', m.plan[2].status === 'done' && m.plan[3].status === 'queued');
  adv(MC, 1); m = mission(MC, r.id);
  check('independent steps run together in one tick', [3, 4, 5, 6].every(i => m.plan[i].status === 'done') && new Set([3, 4, 5, 6].map(i => m.plan[i].doneTick)).size === 1 && m.plan[7].status === 'queued', m.plan.map(s => s.status).join());
  adv(MC, 2); m = mission(MC, r.id);
  check('whole plan in six levels (six ticks)', m.phase === 'monitoring' && m.plan.every(s => s.status === 'done' || s.status === 'skipped'), m.phase);
  adv(MC, 40); m = mission(MC, r.id);
  check('reaches monitoring event-driven', m.phase === 'monitoring' && m.status === 'running' && m.plan.every(s => s.status === 'done' || s.status === 'skipped'), JSON.stringify(m.plan.map(s => s.kind + ':' + s.status)));
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
  adv(MC, 40);
  m = mission(MC, r.id);
  const blocked = m.plan.filter(s => s.status === 'blocked')[0];
  const ask = m.asks.filter(a => a.status === 'open' && a.kind === 'guardrail')[0];
  check('guardrail blocks and asks', !!blocked && blocked.kind === 'campaign' && ask && m.status === 'waiting', JSON.stringify(m.plan.map(s => s.kind + ':' + s.status)) + ' ' + (w.guardrails && w.guardrails.maxDailySpend));
  if (ask) {
    const ar = MC.missions.answer(m.id, ask.id, ask.options[0]); adv(MC, 40);
    check('answer ok', ar.ok, ar.error);
    m = mission(MC, m.id);
    check('continues after answer', m.phase === 'monitoring' || m.plan.some(s => s.kind === 'campaign' && s.status === 'done'), JSON.stringify(m.plan.map(s => s.kind + ':' + s.status)));
  }
  // clarifying ask
  r = MC.missions.createSync('Win back lapsed customers');
  adv(MC, 5);
  m = mission(MC, r.id);
  const ca = m.asks.filter(a => a.status === 'open')[0];
  check('clarifying ask from Lead', ca && ca.agentId === 'lead' && m.plan[0].status === 'blocked');
  if (ca) { MC.missions.answer(m.id, ca.id, ca.options[1]); adv(MC, 3); m = mission(MC, m.id); const ca2 = m.asks.filter(a => a.status === 'open')[0]; if (ca2) MC.missions.answer(m.id, ca2.id, ca2.options[1]); adv(MC, 40); m = mission(MC, m.id); check('clarified mission proceeds', m.phase === 'monitoring', m.phase + ' ' + m.status); }

  // ---- steer -> replan
  r = MC.missions.createSync('Hit $12k in revenue by Dec 8 with a Cyber Monday push');
  adv(MC, 40);
  m = mission(MC, r.id);
  const before = m.plan.length;
  const sr = MC.missions.steer(m.id, 'no SMS and keep the discount under 10%');
  adv(MC, 40);
  m = mission(MC, m.id);
  const c2 = w.campaigns.byId[(m.artifacts.filter(a => a.kind === 'campaign')[0] || {}).id];
  check('steer adds steps and beats', sr.ok && m.plan.length > before && m.log.some(b => b.kind === 'replan'), JSON.stringify(sr));
  check('steer constraints', m.objective.constraints.some(c => c.kind === 'excludeChannel' && c.value === 'sms') && m.objective.constraints.some(c => c.kind === 'maxDiscountPct' && c.value === 10));
  w = MC.store.getState();
  const c3 = w.campaigns.byId[c2.id];
  check('steer acts on artifacts', c3.channels.indexOf('sms') < 0 && (MC.lead.OFFER_PCT[c3.offer] || 0) <= 10, JSON.stringify([c3.channels, c3.offer]));
  MC.missions.steer(m.id, 'pause until Monday');
  check('pause', mission(MC, m.id).status === 'paused');

  // ---- selectors
  const rows = MC.select.missions(MC.store.getState());
  check('selector rows', rows.length >= 4 && rows[0].progress && rows[0].objective.text);
  check('selector detail', MC.select.mission(MC.store.getState(), 'm-lhw').beats.length > 0 && MC.select.missionAsks(MC.store.getState()).length >= 1 && MC.select.missionAgents(MC.store.getState()).length === 9);

  // ---- seeded ask answer executes real extend
  MC.missions.answer('m-lhw', 'a1', mission(MC, 'm-lhw').asks[0].options[0]);
  adv(MC, 40);
  const lhw = mission(MC, 'm-lhw');
  check('seed ask answered runs to monitoring', lhw.phase === 'monitoring', JSON.stringify(lhw.plan.map(s => s.kind + ':' + s.status)));
  adv(MC, 24 * 5);


  // ---- §5 decisions: every executed step records what the agent weighed
  const decOk = d => d && Array.isArray(d.options) && d.options.length >= 1 && d.options.every(o => o.label && typeof o.value === 'string' && typeof o.note === 'string') && typeof d.chose === 'string' && d.chose && typeof d.why === 'string' && d.why.length > 5;
  {
    let M2 = await boot(), rr = M2.missions.createSync('Win back 400 lapsed hikers before Dec 15 without discounting more than 15%');
    adv(M2, 14);
    const mm = M2.store.getState().missions.byId[rr.id];
    check('every finished step has a decision', mm.plan.every(s => decOk(s.decision)), JSON.stringify(mm.plan.filter(s => !decOk(s.decision)).map(s => s.kind)));
    const dk = k => (mm.plan.filter(s => s.kind === k)[0] || {}).decision;
    check('scout weighs candidate audiences with sizes', dk('audience').options.length >= 2 && dk('audience').options.every(o => /people/.test(o.value)));
    check('copy weighs angles with lift or history', dk('copy').options.length >= 2 && dk('copy').options.every(o => typeof o.value === 'string' && o.value.length));
    check('guard weighs thresholds with people affected', dk('guard').options.length >= 3 && dk('guard').options.every(o => /\d/.test(o.value)));
    check('send-time weighs hours with open shares', dk('sendtime').options.filter(o => /% of opens/.test(o.value)).length >= 2);
    check('pacer weighs channels by next-dollar return', dk('pacer').options.length >= 2 && dk('pacer').options.every(o => /next dollar/.test(o.value)));
    check('decision on the step is linked from its beat', mm.log.some(b => b.stepId && mm.plan.some(s => s.id === b.stepId && s.decision)));
    check('no $0.00 return beat', !mm.log.some(b => /\$0\.00/.test(b.text)) && !mm.plan.some(s => /\$0\.00/.test(JSON.stringify(s.decision))), mm.log.filter(b => /\$0\.00/.test(b.text)).map(b => b.text).join('|'));
    // §5 forecast verdict on mission progress
    const v = M2.missions.verdict(M2.store.getState(), mm);
    check('verdict shape', v && ['value', 'target', 'forecast', 'lo', 'hi', 'by'].every(k => typeof v[k] === 'number') && ['on pace', 'behind', 'ahead', 'too early'].includes(v.verdict) && v.by === mm.objective.by, JSON.stringify(v));
    check('verdict stored on progress by the monitor step', mm.progress && ['on pace', 'behind', 'ahead', 'too early'].includes(mm.progress.verdict) && mm.progress.by === mm.objective.by, JSON.stringify(mm.progress));
    M2.metrics.mission = () => ({ value: 100, forecast: { value: 312, lo: 260, hi: 365 } });
    const v2 = M2.missions.verdict(M2.store.getState(), mm);
    check('verdict reads MC.metrics.mission when present', v2.value === 100 && v2.forecast === 312 && v2.lo === 260 && v2.hi === 365 && /312/.test(v2.text) && /260/.test(v2.text), JSON.stringify(v2));
    // §5 asks count: MC.metrics.asks wins when present
    const wA = M2.store.getState(), cnt = M2.missions.openAskCount(wA), real = M2.metrics.asks;
    check('open asks come from MC.metrics.asks when present', typeof real !== 'function' || cnt === real(wA).count, cnt);
    M2.metrics.asks = () => ({ count: 7 });
    check('openAskCount follows the metrics selector', M2.missions.openAskCount(wA) === 7);
    M2.metrics.asks = real; if (typeof real !== 'function') delete M2.metrics.asks;
    delete M2.metrics.mission;
    // waiting for sign-off always has an ask behind it
    const launchOpen = () => mission(M2, rr.id).asks.some(a => a.kind === 'launch' && a.status === 'open');
    check('draft campaign has an open sign-off ask', launchOpen());
    const la = mission(M2, rr.id).asks.filter(a => a.kind === 'launch')[0];
    M2.missions.answer(rr.id, la.id, 'Not yet');
    check('answered "not yet" has no open ask right away', !launchOpen());
    adv(M2, 24 * 4);
    check('sign-off ask comes back after a "not yet"', launchOpen());
    // a plan with no hand-off step still raises the ask
    const w3 = M2.store.getState(), base = M2.lead.plan(w3, 'Hit $9k in revenue by Dec 9');
    const pl = base.plan.filter(s => s.kind !== 'handoff').map(s => Object.assign({}, s, { needs: s.needs.filter(n => base.plan.find(x => x.id === n).kind !== 'handoff') }));
    const cr = M2.store.dispatch({ type: 'mission/create', payload: { goalText: 'Hit $9k in revenue by Dec 9', title: base.title, objective: base.objective, plan: pl, asks: [], data: base.data, brain: 'rules' } });
    check('plan without hand-off created', cr.ok, cr.error);
    adv(M2, 12);
    const m3 = mission(M2, cr.created[0]), beat3 = m3.log.filter(b => /waiting for your sign-off/.test(b.text))[0];
    check('no hand-off step still raises the sign-off ask', m3.phase === 'monitoring' && m3.asks.some(a => a.kind === 'launch' && a.status === 'open'), m3.phase + JSON.stringify(m3.asks.map(a => a.kind + a.status)));
    check('"waiting for sign-off" appears only with an open ask', !beat3 || m3.asks.some(a => a.kind === 'launch'));
  }

  // ---- §5 steering: diff beats; removing a channel removes it everywhere
  {
    let M3 = await boot(), rr = M3.missions.createSync('Hit $12k in revenue by Dec 8 with a Cyber Monday push');
    adv(M3, 10);
    let mm = mission(M3, rr.id), c0 = M3.store.getState().campaigns.byId[mm.data.campaignId];
    check('campaign starts with sms', c0.channels.indexOf('sms') >= 0 && M3.catalog.variantsOf(M3.store.getState(), c0.id, 'sms').length > 0);
    M3.missions.steer(rr.id, 'skip SMS, spend under $2k and discounts under 10%');
    adv(M3, 10);
    const w4 = M3.store.getState(); mm = mission(M3, rr.id); const c1 = w4.campaigns.byId[c0.id];
    check('sms gone from campaign channels', c1.channels.indexOf('sms') < 0);
    check('sms gone from budget, alloc, send hours, paused map', !('sms' in c1.budget.byChannel) && !('sms' in c1.alloc) && !('sms' in c1.sendHour) && !('sms' in c1.channelPaused));
    check('sms gone from the journey', !c1.journey.steps.some(s => s.channel === 'sms') && JSON.stringify(c1.journey.steps).indexOf('sms') < 0);
    check('sms gone from published messages', M3.catalog.variantsOf(w4, c1.id).every(v => v.channel !== 'sms'));
    check('sms gone from mission notes', (mm.data.channels || []).indexOf('sms') < 0 && ((mm.data.content || {}).channels || []).indexOf('sms') < 0 && (!mm.data.optimalSplit || !('sms' in mm.data.optimalSplit)));
    check('budget total respects the spend limit', c1.budget.total <= 2000, c1.budget.total);
    check('later steps (rewrite) do not bring sms back', M3.catalog.variantsOf(w4, c1.id).every(v => v.channel !== 'sms') && mm.plan.every(s => s.status === 'done' || s.status === 'skipped'));
    const diffs = mm.log.filter(b => b.diff && b.diff.length);
    check('steering beats carry diffs {what, from, to}', diffs.length >= 3 && diffs.every(b => b.diff.every(d => d.what && typeof d.from === 'string' && typeof d.to === 'string')), JSON.stringify(diffs.map(b => b.diff)));
    check('channel diff names the removal', diffs.some(b => b.diff.some(d => d.what === 'Channels' && /SMS/.test(d.from) && !/SMS/.test(d.to))));
    check('offer and budget diffs', diffs.some(b => b.diff.some(d => d.what === 'Offer')) && diffs.some(b => b.diff.some(d => /udget/.test(d.what) && /\$2,000/.test(d.to))));
    check('pacer pushes back on the spend cut (disagree beat with both sides + resolution)', mm.log.some(b => b.kind === 'disagree' && b.agentId === 'pacer' && b.sides.length === 2 && b.sides.every(x => x.position) && b.resolution), JSON.stringify(mm.log.filter(b => b.kind === 'disagree')));
    check('no sms mention in later beats about the campaign channels', !mm.log.slice(-3).some(b => /email, sms/i.test(b.text)));
    // "no SMS" given in the goal itself never puts sms in
    let r4 = M3.missions.createSync('Hit $10k in revenue by Dec 8, skip SMS'); adv(M3, 10);
    const m4 = mission(M3, r4.id), c4 = M3.store.getState().campaigns.byId[m4.data.campaignId];
    check('goal-time "skip SMS" keeps sms out', c4.channels.indexOf('sms') < 0 && M3.catalog.variantsOf(M3.store.getState(), c4.id, 'sms').length === 0 && !JSON.stringify(c4.journey.steps).includes('sms'));
    // the new catalog action refuses to empty a campaign
    const w6 = M3.store.getState(), cd = w6.campaigns.byId[c1.id];
    const ra = M3.catalog.apply(w6, { type: 'campaign/dropChannel', payload: { id: cd.id, channel: 'email' } }, { origin: 'agent:planner' });
    check('agents may not drop channels outside a mission', !ra.ok, ra.error);
    let rl = null;
    cd.channels.slice().forEach(ch => { rl = M3.catalog.apply(M3.store.getState(), { type: 'campaign/dropChannel', payload: { id: cd.id, channel: ch } }, { origin: 'agent:planner', mission: true }); });
    check('a campaign always keeps one channel', M3.store.getState().campaigns.byId[cd.id].channels.length === 1 && rl && !rl.ok);
  }

  // ---- §5 disagreement: Fatigue Guard vs the send
  {
    let M4 = await boot(), w5 = M4.store.getState();
    const P = w5.profiles;
    for (let i = 0; i < P.n; i++) for (let k = 0; k < 21; k++) P.sent7[i * 21 + k] = i % 3 === 0 ? 2 : 0;   // a third of everyone is over a 3 a week limit
    let rr = M4.missions.createSync('Win back 400 lapsed hikers before Dec 15, no more than 3 emails a week');
    adv(M4, 10);
    const mm = mission(M4, rr.id), dis = mm.log.filter(b => b.kind === 'disagree' && b.agentId === 'guard')[0];
    check('Fatigue Guard disagrees with the proposed send', !!dis && dis.sides.length === 2 && dis.sides.some(x => x.agentId === 'guard') && dis.sides.some(x => x.agentId === 'copy' || x.agentId === 'planner') && /rest|Guard/i.test(dis.resolution), JSON.stringify(mm.log.filter(b => b.agentId === 'guard')));
    check('the disagreement is resolved by real suppression', mm.plan.filter(s => s.kind === 'guard')[0].actions.some(a => a.type === 'profiles/suppress' && a.count > 0));
    // Budget Pacer pushes back on asking for more budget
    const rm = M4.lead.remediate(M4.store.getState(), mm, { pace: 0.5, forecast: 200, target: 400, daysLeft: 6, campaignId: null, replans: 2, linked: false, pacer: { marginal: 0.4, lowCh: 'push', hiCh: 'email' } });
    const pd = rm.beats.filter(b => b.kind === 'disagree')[0];
    check('Pacer pushes back on an over-budget ask', pd && pd.agentId === 'pacer' && pd.sides.length === 2 && pd.resolution && rm.asks.length === 1 && /Budget Pacer/.test(rm.asks[0].why), JSON.stringify(rm));
    const rm2 = M4.lead.remediate(M4.store.getState(), mm, { pace: 0.5, forecast: 200, target: 400, daysLeft: 6, campaignId: null, replans: 2, linked: false, pacer: { marginal: 1.8, lowCh: 'push', hiCh: 'email' } });
    check('Pacer agrees when more budget pays back', !rm2.beats.some(b => b.kind === 'disagree') && /agrees/.test(rm2.asks[0].why));
  }

  // ---- determinism + replay
  async function scenario() {
    const M = await boot();
    M.missions.createSync('Win back 400 lapsed hikers before Dec 15 without discounting more than 15%');
    adv(M, 30);
    M.missions.createSync('Hit $9k in revenue by Dec 5');
    adv(M, 30);
    M.missions.steer(M.store.getState().missions.order.slice(-1)[0], 'no push');
    adv(M, 24 * 4);
    return M;
  }
  const A = await scenario(), B = await scenario();
  const dig = M => ({ s: M.replay.digestWorld(M.store.getState()).state, m: M.util.digest(M.store.getState().missions) });
  const da = dig(A), db = dig(B);
  check('deterministic digests', da.s === db.s && da.m === db.m, JSON.stringify([da, db]));
  const live = A.store.getState();
  check('state digest covers missions', A.replay.digestWorld(live).parts.entities !== undefined && JSON.stringify(Object.keys(live.meta)).indexOf('seedTarget') >= 0);
  A.data.seedTarget = 0; // a different boot date must not change replay
  const rep = await A.replay.run({ seed: live.meta.seed, seedTarget: live.meta.seedTarget, log: live.log.slice(), toTick: live.meta.tick });
  const dr = { s: A.replay.digestWorld(rep).state, m: A.util.digest(rep.missions) };
  check('replay equality', dr.s === da.s && dr.m === da.m, JSON.stringify([dr, da]));
  console.log(fails ? 'missions-test: ' + fails + ' FAIL, ' + passes + ' pass' : 'missions-test: all ' + passes + ' pass');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('RUN FAIL', e.stack); process.exit(1); });
