// Canonical metrics tests (Node, loads like tools/smoke.js). Usage: node tools/metrics-test.js [ticks=500]
// docs/CONSISTENCY.md section 1: every quantity has one definition (MC.metrics). Each assertion reads the same quantity through
// every selector or surface path that exposes it and requires the identical number; the last block checks determinism
// (two fresh boots give byte-identical output).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/src="(js\/[^"?]+)(?:\?v=[^"]*)?"/g)].map(m => m[1]).filter(s => s.startsWith('js/core/') || s.startsWith('js/agents/'));
const code = srcs.map(s => [s, fs.readFileSync(path.join(root, s), 'utf8')]);   // read once so every boot runs the same code
function load() {
  const ctx = { console, setTimeout, clearTimeout, performance: { now: () => Date.now() }, Math, Date, JSON, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float32Array, Map, Set, Promise };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const [s, src] of code) vm.runInContext(src, ctx, { filename: s });
  return ctx.MC;
}
let fails = 0, passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { fails++; console.log('FAIL', name, detail === undefined ? '' : detail); } }
function eq(name, a, b, eps) { check(name, (eps ? Math.abs(a - b) <= eps : a === b), a + ' vs ' + b); }
async function world(ticks) {
  const MC = load();
  await MC.engine.boot({ seed: 'fernway', speed: 'pause', catchUp: false });
  let w = MC.store.getState();
  for (let i = 0; i < ticks; i++) w = MC.engine.advance(w);
  return { MC, w: MC.store.getState() };
}
const sum = o => Object.keys(o || {}).reduce((a, k) => a + o[k], 0);

function suite(MC, w, label) {
  const M = MC.metrics, S = MC.select, K = MC.content, F = MC.F, D0 = MC.time.DAY0;
  const L = s => label + ' ' + s;
  check(L('MC.metrics api'), ['campaign', 'mission', 'lift', 'load', 'content', 'messages', 'asks'].every(k => typeof M[k] === 'function'));
  const cids = w.campaigns.order, live = cids.filter(id => w.campaigns.byId[id].status !== 'draft');

  /* ---- (a) campaign revenue: one number on every path ---- */
  const allRange = { range: 'all' };
  const attr = S.attribution(w, allRange);
  live.forEach(id => {
    const c = M.campaign(w, id), st = S.campaignStats(w, id), g = S.campaignGoal(w, id);
    eq(L(id + ' revenue stats'), st.revenue, c.revenue);
    eq(L(id + ' roas'), (st.roas === null ? -1 : st.roas), (c.roas === null ? -1 : c.roas), 1e-9);
    eq(L(id + ' attribution last-touch'), sum(attr.byCampaign[id]), c.revenue, 1e-6);
    const ch = S.channelCompare(w, { range: 'all', campaignIds: [id] });
    eq(L(id + ' channel table sum'), ch.reduce((a, r) => a + r.revenue, 0), c.revenue, 1e-6);
    eq(L(id + ' channel parts'), sum(c.byChannel && Object.keys(c.byChannel).reduce((o, k) => (o[k] = c.byChannel[k].revenue, o), {})), c.revenue, 1e-6);
    if (w.campaigns.byId[id].goal.type === 'revenue') eq(L(id + ' goal value'), g.value, c.revenue, 1e-6);
    // daily series filtered to the campaign adds up to the same figure
    const ser = S.series(w, { metric: 'revenue', range: 'all', campaignIds: [id] });
    const done = ser.filter(p => !p.partial && p.day !== undefined && p.forecast === undefined);
    if (done.length) check(L(id + ' series <= campaign'), done.reduce((a, p) => a + (p.value || 0), 0) <= c.revenue + 1e-6);
    check(L(id + ' revenue is credited, not own-click only'), c.revenue >= c.direct * 0.5, c.revenue + ' vs direct ' + c.direct);
  });
  const rows = S.campaignRows(w);
  rows.forEach(r => { if (r.revenue !== undefined && r.id) eq(L(r.id + ' campaignRows revenue'), r.revenue, M.campaign(w, r.id).revenue, 1e-6); });
  // channels + business split reconcile
  const chAll = S.channelCompare(w, allRange).reduce((a, r) => a + r.revenue, 0), split = S.revenueSplit(w, allRange);
  eq(L('channel table = attribution total'), chAll, sum(attr.byChannel), 1e-6);
  eq(L('credited in split = attribution total'), split.credited, sum(attr.byChannel), 1e-6);
  check(L('credited <= business total'), split.credited <= split.total + 1e-6, split.credited + ' vs ' + split.total);

  /* ---- mission revenue / progress ---- */
  w.missions.order.forEach(id => {
    const m = M.mission(w, id), row = S.missions(w).filter(r => r.id === id)[0], det = S.mission(w, id);
    eq(L(id + ' mission row value'), row.progress.value, m.value);
    eq(L(id + ' mission detail value'), det.progress.value, m.value);
    eq(L(id + ' mission forecast'), row.progress.forecast, m.forecast.value);
    check(L(id + ' verdict enum'), ['on pace', 'behind', 'ahead', 'too early'].includes(m.verdict), m.verdict);
    if (m.metric === 'revenue') eq(L(id + ' mission = sum of campaigns'), m.value, Math.round(m.campaignIds.reduce((a, c) => a + M.campaign(w, c).revenue, 0)));
    eq(L(id + ' mission revenue field'), m.revenue, m.campaignIds.reduce((a, c) => a + M.campaign(w, c).revenue, 0), 1e-6);
    check(L(id + ' forecast range ordered'), m.forecast.lo <= m.forecast.value + 1e-9 && m.forecast.value <= m.forecast.hi + 1e-9 && m.value <= m.forecast.value + 1e-9, JSON.stringify([m.value, m.forecast]));
    const mp = w.missions.byId[id].progress;   // stored daily snapshot may lag, never lead, the live value for revenue
    if (m.metric === 'revenue' && mp) check(L(id + ' snapshot not ahead of live'), mp.value <= m.value + 1, mp.value + ' vs ' + m.value);
  });

  /* ---- (b) holdout: one number, one label ---- */
  const pct = w.meta.universalHoldoutPct === undefined ? 5 : w.meta.universalHoldoutPct;
  eq(L('holdout constant'), M.HOLDOUT_PCT, 5);
  live.forEach(id => {
    const l = M.lift(w, { campaignId: id }), l2 = S.campaignLift(w, id);
    eq(L(id + ' lift selector path'), JSON.stringify(l2), JSON.stringify(l));
    eq(L(id + ' holdoutPct'), l.holdoutPct, pct);
    check(L(id + ' label says 5% held out'), /5% held out/.test(l.label), l.label);
    const E = w.enroll[id];
    if (E && E.step && l.nControl > 0) {
      // treated and holdout exclude the per-campaign control split (it is routed off paid ads and would bias lift)
      const uh = MC.sim.universalHoldoutBits(w); let nT = 0, nC = 0;
      for (let i = 0; i < E.step.length; i++) { if (E.step[i] === -1 || E.ctl[i]) continue; if (uh[i]) nC++; else nT++; }
      eq(L(id + ' nControl = holdout members'), l.nControl, nC); eq(L(id + ' nTreated'), l.nTreated, nT);
      const share = nC / (nC + nT); check(L(id + ' holdout share ~5%'), share > 0.025 && share < 0.085, share);
    }
    if (l.ready) check(L(id + ' interval brackets estimate'), l.lo <= l.liftPct && l.liftPct <= l.hi, JSON.stringify(l));
  });
  w.missions.order.forEach(id => {
    const l = M.lift(w, { missionId: id }); check(L(id + ' mission lift shape'), typeof l.ready === 'boolean' && l.holdoutPct === pct);
    const cs = M.mission(w, id).campaignIds; if (cs.length === 1) eq(L(id + ' mission lift = its campaign'), JSON.stringify(Object.assign({}, l, { scope: 0 })), JSON.stringify(Object.assign({}, M.lift(w, { campaignId: cs[0] }), { scope: 0 })));
  });
  const seg = w.campaigns.byId[live[0]].segmentId; check(L('segment lift shape'), typeof M.lift(w, { segmentId: seg }).ready === 'boolean');
  // honesty: a lift that is "clearly below" must come from a range that excludes zero
  live.forEach(id => { const l = M.lift(w, { campaignId: id }); if (l.ready && /Clearly below/.test(l.note)) check(L(id + ' below means hi<0'), l.hi < 0); });

  /* ---- (d) load: rested people are never "nobody over the cap" ---- */
  const ld = M.load(w), ml = S.messageLoad(w, { days: 7 });
  eq(L('messageLoad.overCap'), ml.overCap, ld.overCap); eq(L('messageLoad.rested'), ml.rested, ld.rested); eq(L('messageLoad.status'), ml.status, ld.status);
  let rest = 0; const P = w.profiles; for (let i = 0; i < P.n; i++) if (P.supUntil[i * 3] > w.meta.tick || P.supUntil[i * 3 + 1] > w.meta.tick || P.supUntil[i * 3 + 2] > w.meta.tick) rest++;
  eq(L('rested = people with an active rest'), ld.rested, rest);
  if (ld.rested > 0) check(L('rested never reads as nobody over'), ld.status === 'resting' && !/nobody is over/i.test(ld.text) && /resting/.test(ld.text), ld.text);
  if (ld.overCap === 0 && ld.rested === 0) check(L('clear text'), ld.status === 'clear');
  eq(L('people counted'), ld.people, P.n);
  eq(L('distribution covers everyone'), ld.distribution.reduce((a, d) => a + d.profiles, 0), P.n);
  live.forEach(id => { const c = M.load(w, { campaignId: id }); check(L(id + ' scoped load <= all'), c.people <= ld.people && c.rested <= ld.rested); });

  /* ---- (e) content: block rows, attribute matrix and contrast use one method ---- */
  const mx = M.content(w, { dim: 'angle' });
  eq(L('matrix is contentMatrix'), JSON.stringify(mx), JSON.stringify(S.contentMatrix(w, { dim: 'angle' })));
  MC.CH.OWNED.forEach(ch => {
    const perf = M.content(w, { by: 'angle', channel: ch });
    eq(L('perf is contentPerformance ' + ch), JSON.stringify(perf), JSON.stringify(S.contentPerformance(w, { by: 'angle', channel: ch })));
    mx.rows.forEach(r => {
      const pr = perf.filter(x => x.key === r.key)[0], cell = r.cells[ch];
      if (pr && cell && cell.enough) eq(L('matrix cell = row ' + r.key + ' ' + ch), JSON.stringify(cell.lift), JSON.stringify(pr.lift));
    });
  });
  // independent recomputation of one within-campaign lift (Mantel-Haenszel over campaign x channel x day) for the biggest email angle
  (function () {
    const rowsE = S.contentPerformance(w, { by: 'angle', channel: 'email' }).filter(r => r.byChannel.email && r.byChannel.email.enough);
    if (!rowsE.length) { check(L('email angle with enough data'), false); return; }
    const target = rowsE[0], t = Math.floor(w.meta.tick / 24);
    let A = 0, B = 0, V = 0;
    w.campaigns.order.forEach(cid => {
      w.metrics.days.forEach((dd, i) => {
        const d = D0 + i, cd = dd.c && dd.c[cid]; if (!cd || !cd.v || d > t) return;
        const vs = Object.keys(cd.v).sort().map(id => [w.variants.byId[id], cd.v[id]]).filter(x => x[0] && x[0].channel === 'email' && x[0].blocks && x[0].blocks.length && x[1][F.SENT] > 0);
        let n1 = 0, k1 = 0, nt = 0, kt = 0;
        vs.forEach(([v, f]) => {
          const hl = v.blocks.map(b => K.block(w, b.id)).filter(b => b && b.kind === 'headline');
          if (!hl.length) return;
          nt += f[F.DELIV]; kt += f[F.OPEN];
          if (hl.some(b => (b.tags && b.tags.angle || 'neutral') === target.key)) { n1 += f[F.DELIV]; k1 += f[F.OPEN]; }
        });
        const n0 = nt - n1, k0 = kt - k1, N = n1 + n0;
        if (n1 > 0 && n0 > 0) { A += k1 * n0 / N; B += k0 * n1 / N; V += (n1 * n0 * (k1 + k0) - k1 * k0 * N) / (N * N); }
      });
    });
    const lr = Math.log(A / B), se = Math.sqrt(V / (A * B)), lf = target.byChannel.email.lift;
    eq(L('independent MH value'), lf.value, Math.exp(lr) - 1, 1e-9);
    eq(L('independent MH lo'), lf.lo, Math.exp(lr - 1.96 * se) - 1, 1e-9);
    eq(L('independent MH hi'), lf.hi, Math.exp(lr + 1.96 * se) - 1, 1e-9);
  })();
  // block rows are within-campaign too: a headline that only ever ran on its own (no alternative in its campaign) gets no lift
  S.contentPerformance(w, { by: 'block', kind: 'headline', channel: 'email' }).forEach(r => {
    if (r.enough) check(L('block lift has interval ' + r.key), r.lift && r.lift.lo <= r.lift.value && r.lift.value <= r.lift.hi);
    else check(L('block without lift explains why ' + r.key), typeof r.reason === 'string' && r.reason.length > 0);
  });
  // blockId scope of lift uses the same row
  const brow = S.contentPerformance(w, { by: 'block' }).filter(r => r.enough && r.lift)[0];
  if (brow) { const bl = M.lift(w, { blockId: brow.key }); eq(L('block lift pct'), bl.liftPct, brow.lift.value * 100, 1e-9); }
  // contrast agrees in sign with the two rows it compares when both enough
  const rc = S.contentRecommendations(w).filter(r => r.kind === 'angle-winner');
  rc.forEach(r => check(L('angle winner interval above zero ' + r.channel), r.contrast && r.contrast.lo > 0));

  /* ---- (f) message counts ---- */
  const lib = M.messages(w), all = K.messages(w);
  eq(L('library messages = content store'), lib.messages, all.length); eq(L('library ids'), lib.ids.length, all.length);
  check(L('channel versions kept apart from messages'), lib.channelVersions >= lib.messages && lib.variants >= lib.channelVersions - 0, JSON.stringify([lib.messages, lib.channelVersions, lib.variants]));
  live.concat(cids).filter((x, i, a) => a.indexOf(x) === i).forEach(id => {
    const m = M.messages(w, { campaignId: id });
    const vs = Object.values(w.variants.byId).filter(v => v.campaignId === id && v.status !== 'retired');
    const distinct = new Set(vs.map(v => v.messageId || (id + '|' + v.name)));
    eq(L(id + ' distinct messages'), m.messages, distinct.size); eq(L(id + ' channel versions'), m.channelVersions, new Set(vs.map(v => (v.messageId || (id + '|' + v.name)) + '|' + v.channel)).size);
    check(L(id + ' messages <= channel versions'), m.messages <= m.channelVersions || m.channelVersions === 0);
  });
  w.missions.order.forEach(id => {
    const mm = M.messages(w, { missionId: id }), cs = M.mission(w, id).campaignIds;
    const byC = new Set(); cs.forEach(c => M.messages(w, { campaignId: c }).ids.forEach(x => byC.add(x)));
    (w.missions.byId[id].artifacts || []).filter(a => a.kind === 'message').forEach(a => byC.add(a.id));
    eq(L(id + ' mission messages = union of its campaigns'), mm.messages, byC.size);
  });

  /* ---- (g) asks: one count ---- */
  const ak = M.asks(w);
  eq(L('asks count'), ak.count, ak.missionAsks.length + ak.proposals.length);
  eq(L('openProposals selector'), S.openProposals(w).length, ak.proposals.length); eq(L('missionAsks selector'), S.missionAsks(w).length, ak.missionAsks.length);
  check(L('every counted proposal is pending and not superseded'), ak.proposals.every(p => p.status === 'pending' && !p.supersededBy));
  check(L('every counted ask is open on a live mission'), ak.missionAsks.every(a => a.ask.status === 'open' && w.missions.byId[a.missionId].status !== 'done' && w.missions.byId[a.missionId].status !== 'stopped'));
  let ind = 0; (w.proposals.open || []).forEach(id => { const p = w.proposals.byId[id]; if (p && p.status === 'pending' && !p.supersededBy) ind++; });
  Object.values(w.missions.byId).forEach(m => { if (m.status !== 'done' && m.status !== 'stopped') (m.asks || []).forEach(a => { if (a.status === 'open') ind++; }); });
  eq(L('independent count of asks'), ak.count, ind);
  eq(L('byMission adds up'), Object.keys(ak.byMission).reduce((a, k) => a + ak.byMission[k], 0), ak.missionAsks.length + ak.proposals.filter(p => p.missionId).length);
  return JSON.stringify({
    c: live.map(id => M.campaign(w, id)), m: w.missions.order.map(id => M.mission(w, id)), l: live.map(id => M.lift(w, { campaignId: id })),
    ld: M.load(w), mx: M.content(w, { dim: 'angle' }), ms: M.messages(w), ak: { n: ak.count, m: ak.missionAsks.length, p: ak.proposals.map(p => p.id) }
  });
}

(async () => {
  const ticks = +process.argv[2] || 500;
  const a = await world(ticks);
  const d1 = suite(a.MC, a.w, 't' + ticks);
  const e = await world(300);
  suite(e.MC, e.w, 't300');
  const b = await world(ticks);
  const d2 = suite(b.MC, b.w, 't' + ticks + ' second boot');
  check('deterministic across two boots', d1 === d2);
  console.log((fails ? 'FAILED ' : 'ok ') + passes + ' passed, ' + fails + ' failed');
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('RUN FAIL', e.stack); process.exitCode = 1; });
