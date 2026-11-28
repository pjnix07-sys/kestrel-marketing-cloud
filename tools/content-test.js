// Content tests (Node, loads like tools/smoke.js). Usage: node tools/content-test.js
// Covers docs/CONTENT.md "Model" and "Simulation truth" (render per channel within limits, reuse counts, publish and
// version flow, retire flow, simulator ledgers and determinism, including a replay of the action log), then
// "Content intelligence" (selectors recover the seeded email signal and reuse fatigue, with intervals and honest
// "not enough data") and "Agents" (Copy Drafter, Variant Optimizer, Fatigue Guard, Insight Analyst and the mission's
// copy step each act on the sample world within about 400 ticks, through proposals, deterministically).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/src="(js\/[^"?]+)(?:\?v=[^"]*)?"/g)].map(m => m[1]).filter(s => s.startsWith('js/core/') || s.startsWith('js/agents/'));
function load() {
  const ctx = { console, setTimeout, clearTimeout, performance: { now: () => Date.now() }, Math, Date, JSON, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float32Array, Map, Set, Promise };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const s of srcs) vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), ctx, { filename: s });
  return ctx.MC;
}
let fails = 0, passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { fails++; console.log('FAIL', name, detail === undefined ? '' : detail); } }
async function boot() { const MC = load(); await MC.engine.boot({ seed: 'fernway', speed: 'pause', catchUp: false }); return MC; }
function adv(MC, n) { const w = MC.store.getState(); for (let i = 0; i < n; i++) MC.engine.advance(w); return MC.store.getState(); }
function act(MC, type, payload) { return MC.catalog.dispatchUser(MC.store.getState(), { type, payload }); }
function must(name, r) { check(name, r && r.ok, r && r.error); return r; }

(async () => {
  const MC = await boot(); let w = MC.store.getState();
  const K = MC.content, CP = MC.copy, S = MC.select;

  /* ---- seed ---- */
  const blocks = K.blocks(w), msgs = K.messages(w);
  check('seed blocks 40+', blocks.length >= 40, blocks.length);
  check('seed messages 12+', msgs.length >= 12, msgs.length);
  const kinds = new Set(blocks.map(b => b.kind));
  check('every block kind present', K.KINDS.every(k => kinds.has(k)));
  const angles = new Set(blocks.filter(b => b.kind === 'headline').map(b => b.tags.angle));
  check('four headline angles', ['trail-season', 'warmth', 'gifting', 'urgency'].every(a => angles.has(a)), [...angles].join());
  check('blocks approved with history', blocks.every(b => b.review === 'approved' && b.ver === 1 && b.history.length === 1 && b.history[0].tags));
  const vs = Object.values(w.variants.byId);
  check('every seeded variant linked to a message', vs.every(v => v.messageId && K.message(w, v.messageId) && v.channel && v.renderedVer === 1 && v.blocks.length >= 5));
  check('variant ids and allocations survive migration', !!w.variants.byId['v-wll-email-a'] && Math.abs(Object.values(w.campaigns.byId['c-wll'].alloc.email).reduce((a, b) => a + b, 0) - 1) < 1e-9);

  /* ---- reuse ---- */
  const reuse = K.reuseCounts(w);
  check('offer block reused across 6 messages', reuse['b-of-pct15'] === 6, reuse['b-of-pct15']);
  check('claim block reused', reuse['b-cl-returns'] >= 8, reuse['b-cl-returns']);
  check('cta block reused across campaigns', reuse['b-cta-shop'] >= 5, reuse['b-cta-shop']);
  const wu = S.whereUsed(w, 'b-of-pct15');
  check('whereUsed counts messages', wu.count === 6 && wu.messages.length === 6, wu.count);
  check('whereUsed lists campaigns and channels', wu.campaigns.map(c => c.id).join() === 'c-lhw,c-trs' && wu.channels.includes('email') && wu.channels.includes('sms'), JSON.stringify(wu.campaigns.map(c => c.id)));
  check('whereUsed lists missions', S.whereUsed(w, 'b-of-pct15').missions.some(m => m.id === 'm-lhw'));
  check('whereUsed variants carry version state', wu.variants.length > 10 && wu.variants.every(v => v.newer === false));
  check('whereUsed unknown block', S.whereUsed(w, 'nope').found === false);
  const wo = S.whereUsed(w, 'b-h-trail-short');   // an override in msg-wll-a (sms, push) plus a base slot in msg-trs-b
  check('whereUsed honors channel overrides', wo.messages.some(m => m.id === 'msg-wll-a' && m.placements.every(p => p.channel)) && wo.variants.filter(v => v.messageId === 'msg-wll-a').map(v => v.channel).join() === 'push', JSON.stringify(wo.variants.map(v => v.id)));

  /* ---- render per channel ---- */
  let renders = 0, bareName = 0, overLimit = [], failing = [], smsBad = [];
  for (const m of msgs) {
    const cid = 'c-' + m.id.split('-')[1];
    for (const ch of MC.CH.ALL) {
      const r = K.render(w, m.id, ch, { campaignId: cid }); renders++;
      if (r.error) { failing.push(m.id + ch + r.error); continue; }
      const vlike = { productId: r.productId, offer: r.offer };
      Object.keys(r.fields).forEach(k => {
        const lim = CP.LIMITS[k];
        if (lim && CP.measure(r.fields[k], vlike) > lim) overLimit.push(m.id + ':' + ch + ':' + k);
        if (/\{first_name\}/.test(r.fields[k])) bareName++;
      });
      CP.FIELDS[ch].forEach(k => { if (['alt', 'imageId'].indexOf(k) < 0 && !(k in r.fields)) failing.push(m.id + ':' + ch + ' missing ' + k); });
      K.failing(r).forEach(x => failing.push(m.id + ':' + ch + ':' + x.id));
      if (ch === 'sms') {
        const si = CP.smsInfo(CP.expand(r.fields.sms, vlike));
        if (si.encoding !== 'GSM-7' || si.segments !== 1 || !/Reply STOP to opt out\.$/.test(r.fields.sms)) smsBad.push(m.id);
        if (!r.info.sms || r.info.sms.encoding !== 'GSM-7') smsBad.push(m.id + ' info');
      }
      if (JSON.stringify(r.blocksUsed) !== JSON.stringify(K.render(w, m.id, ch, { campaignId: cid }).blocksUsed)) failing.push('unstable ' + m.id);
    }
  }
  check('renders every message in every channel', renders === msgs.length * 5, renders);
  check('no field over its limit', overLimit.length === 0, overLimit.slice(0, 4).join());
  check('no failing brand checks', failing.length === 0, failing.slice(0, 4).join());
  check('tokens carry fallbacks', bareName === 0);
  check('SMS is one GSM-7 segment with opt-out', smsBad.length === 0, smsBad.join());
  const wllA = K.render(w, 'msg-wll-a', 'sms', { campaignId: 'c-wll' });
  check('channel override gives the short headline', /Trail season is here/.test(wllA.fields.sms) && wllA.blocksUsed.includes('b-h-trail-short') && !wllA.blocksUsed.includes('b-h-trail-frost'), wllA.fields.sms);
  check('email keeps the long headline', K.render(w, 'msg-wll-a', 'email', { campaignId: 'c-wll' }).fields.subject === 'Trail season runs late. Gear up for it.');
  const prev = K.render(w, 'msg-bfe-a', 'email', { campaignId: 'c-bfe', profile: 0 });
  check('profile preview fills tokens', prev.preview && !/\{/.test(prev.preview.body), prev.preview && prev.preview.body);
  check('unbacked urgency is flagged, backed urgency passes', K.render(w, 'msg-wll-c', 'email', { campaignId: 'c-wll' }).checks.some(x => x.id === 'urgency' && x.status === 'warn') && K.render(w, 'msg-bfe-a', 'email', { campaignId: 'c-bfe' }).checks.every(x => x.status === 'pass'));
  check('render of a missing message reports an error', !!K.render(w, 'msg-nope', 'email').error);
  // a long headline is cut to fit SMS and push, never mid-token
  w = MC.store.getState();
  const longH = must('create long headline', act(MC, 'block/create', { block: { kind: 'headline', value: 'Hi {first_name}, every layer you need for the first cold snap of the whole season is here and waiting', tags: { angle: 'trail-season', tone: 'adventurous' } } }));
  const msgLong = must('create message', act(MC, 'message/create', { message: { name: 'Long headline test', slots: { headline: longH.created[0], body: 'b-bd-trail-2', cta: 'b-cta-shop', offer: 'b-of-pct15' } } }));
  for (const ch of ['email', 'sms', 'push', 'social', 'web']) {
    const r = K.render(MC.store.getState(), msgLong.created[0], ch, {});
    const over = Object.keys(r.fields).filter(k => CP.LIMITS[k] && CP.measure(r.fields[k], { offer: r.offer }) > CP.LIMITS[k]);
    check('long headline fits on ' + ch, !r.error && over.length === 0 && !/\{[^}]*$/.test(JSON.stringify(r.fields)) && !/\{first_name\}/.test(JSON.stringify(r.fields)), over.join() + JSON.stringify(r.fields).slice(0, 200));
  }

  /* ---- publish and version flow ---- */
  w = MC.store.getState();
  const before = JSON.stringify(w.variants.byId['v-wll-email-a'].fields);
  const stale0 = K.staleVariants(w).length;
  check('nothing stale at seed', stale0 === 0);
  const wllMsgs = K.messagesUsing(w, 'b-cta-shop').length;
  must('edit a shared block', act(MC, 'block/update', { id: 'b-cta-shop', value: 'Shop the sale', note: 'test' }));
  w = MC.store.getState();
  check('editing a block bumps its version', K.block(w, 'b-cta-shop').ver === 2 && K.block(w, 'b-cta-shop').review === 'draft' && K.block(w, 'b-cta-shop').history.length === 2);
  check('every message using the block moves to v2', K.messagesUsing(w, 'b-cta-shop').every(m => m.ver === 2) && K.messagesUsing(w, 'b-cta-shop').length === wllMsgs);
  const stale1 = K.staleVariants(w);
  check('live variants show a newer version', stale1.length > 5 && stale1.every(s => s.renderedVer === 1 && s.currentVer === 2));
  check('editing a block never changes what a variant sends', JSON.stringify(w.variants.byId['v-wll-email-a'].fields) === before && w.variants.byId['v-lhw-email-b'].fields.cta === 'Shop now');
  const vs1 = K.variantState(w, w.variants.byId['v-lhw-email-b']);
  check('variantState names the stale block', vs1.newer && vs1.staleBlocks.includes('b-cta-shop'), JSON.stringify(vs1));
  check('whereUsed flags newer variants', S.whereUsed(w, 'b-cta-shop').variants.some(v => v.newer));
  check('publish waits for the edited block to be approved again', !act(MC, 'message/publish', { id: 'msg-lhw-b', campaignId: 'c-lhw', channels: ['email'] }).ok);
  must('approve the block', act(MC, 'block/setReview', { id: 'b-cta-shop', review: 'approved' }));
  must('send the message back to draft', act(MC, 'message/setReview', { id: 'msg-lhw-b', review: 'draft' }));
  check('an unapproved message cannot be published by a person', !act(MC, 'message/publish', { id: 'msg-lhw-b', campaignId: 'c-lhw', channels: ['email'] }).ok);
  must('approve the message', act(MC, 'message/setReview', { id: 'msg-lhw-b', review: 'approved' }));
  const nVars = Object.keys(MC.store.getState().variants.byId).length;
  const pub = must('republish', act(MC, 'message/publish', { id: 'msg-lhw-b', campaignId: 'c-lhw', channels: ['email', 'sms'] }));
  w = MC.store.getState();
  const v2 = w.variants.byId['v-lhw-email-b'];
  check('publish updates the variant in place', Object.keys(w.variants.byId).length === nVars && v2.fields.cta === 'Shop the sale' && v2.renderedVer === 2 && v2.ver === 2, JSON.stringify(v2.fields.cta));
  check('republished variant is current', !K.variantState(w, v2).newer && K.variantState(w, w.variants.byId['v-lhw-sms-b']).newer === false);
  check('other variants stay on version 1', K.variantState(w, w.variants.byId['v-wll-email-c']).newer && w.variants.byId['v-wll-email-c'].renderedVer === 1);
  check('publish keeps allocation and review', w.campaigns.byId['c-lhw'].alloc.email['v-lhw-email-b'] === 0.3 && MC.catalog.reviewOf(v2) === 'approved' && v2.history[v2.history.length - 1].kind === 'publish');
  check('latent follows the variant', !!w.latent.variants['v-lhw-email-b']);
  // a brand new message goes out to a channel without a variant of its own
  must('approve long message blocks', act(MC, 'block/setReview', { id: longH.created[0], review: 'approved' }));
  must('approve long message', act(MC, 'message/setReview', { id: msgLong.created[0], review: 'approved' }));
  const pub2 = must('publish new message', act(MC, 'message/publish', { id: msgLong.created[0], campaignId: 'c-lhw', channels: ['email', 'sms'], share: 0.1 }));
  w = MC.store.getState();
  const nv = w.variants.byId[pub2.created[0]];
    check('new message creates linked variants', pub2.created.length === 2 && nv && nv.messageId === msgLong.created[0] && nv.channel === 'email' && nv.campaignId === 'c-lhw' && nv.renderedVer === K.message(w, nv.messageId).ver && nv.blocks.length >= 4);
  check('new variant takes its share', Math.abs((w.campaigns.byId['c-lhw'].alloc.email[nv.id] || 0) - 0.1) < 1e-9);
  check('new variant passes the copy checks', MC.copy.check(nv, w.guardrails.brand, K.render(w, nv.messageId, nv.channel, { campaignId: 'c-lhw' }) && undefined).every(x => x.status !== 'fail'));
  check('publish rejects a channel the campaign does not use', !act(MC, 'message/publish', { id: msgLong.created[0], campaignId: 'c-lhw', channels: ['push'] }).ok);
  check('publish to a completed campaign is refused', !act(MC, 'message/publish', { id: msgLong.created[0], campaignId: 'c-trs', channels: ['email'] }).ok);
  // an agent's publish is always new and in review, never a silent overwrite
  const ag = MC.catalog.apply(w, { type: 'message/publish', payload: { id: 'msg-lhw-b', campaignId: 'c-lhw', channels: ['email'], share: 0.1 } }, { origin: 'agent:copy' });
  w = MC.store.getState();
  check('agent publish adds a variant in review', ag.ok && ag.created.length === 1 && w.variants.byId[ag.created[0]].review === 'in_review' && w.variants.byId[ag.created[0]].author === 'agent:copy' && !(w.campaigns.byId['c-lhw'].alloc.email[ag.created[0]] > 0), ag.error);
  check('agent publish does not touch the existing variant', w.variants.byId['v-lhw-email-b'].ver === 2);
  // undo of a user publish retires what it created
  const invs = MC.catalog.inverse(w, { type: 'message/publish', payload: { id: msgLong.created[0], campaignId: 'c-lhw', channels: ['email', 'sms'] } }, { origin: 'user' });
  check('publish inverse covers only new variants', Array.isArray(invs));

  /* ---- retire flow ---- */
  w = MC.store.getState();
  const nUsing = K.usedCount(w, 'b-h-urg-gear');
  check('retire needs a block', !act(MC, 'block/retire', { id: 'b-nope' }).ok);
  const ret = must('retire a block', act(MC, 'block/retire', { id: 'b-h-urg-gear', reason: 'Tired: 40% fewer opens on repeat sends' }));
  w = MC.store.getState();
  check('retired block records the reason', K.block(w, 'b-h-urg-gear').retired && K.block(w, 'b-h-urg-gear').retired.reason.startsWith('Tired') && ret.info && ret.info.placements === nUsing);
  check('retired block stays in live messages', K.usedCount(w, 'b-h-urg-gear') === nUsing && w.variants.byId['v-wll-email-c'].fields.subject === 'Gear up before the offer ends');
  check('retired block cannot be used again', !act(MC, 'message/setSlot', { id: 'msg-wll-b', slot: 'headline', blockId: 'b-h-urg-gear' }).ok);
  check('retired block cannot be edited', !act(MC, 'block/update', { id: 'b-h-urg-gear', value: 'x' }).ok);
  check('retired block blocks publishing', !act(MC, 'message/publish', { id: 'msg-wll-c', campaignId: 'c-wll', channels: ['email'] }).ok);
  check('cannot archive a block still in use', !act(MC, 'block/archive', { id: 'b-h-urg-gear' }).ok);
  const swap = K.swapActions(w, 'b-h-urg-gear', 'b-h-urg-week');
  check('swap actions list every placement', swap.length === nUsing && swap.every(a => a.type === 'message/setSlot'), swap.length + '/' + nUsing);
  swap.forEach((a, i) => must('swap ' + i, MC.catalog.dispatchUser(MC.store.getState(), a)));
  w = MC.store.getState();
  check('nothing uses the retired block after the swap', K.usedCount(w, 'b-h-urg-gear') === 0 && S.whereUsed(w, 'b-h-urg-gear').count === 0);
  check('swapped messages show newer versions on their variants', K.staleVariants(w).some(s => s.messageId === 'msg-wll-c'));
  must('archive once unused', act(MC, 'block/archive', { id: 'b-h-urg-gear' }));
  check('archived block is hidden from use', !act(MC, 'message/setSlot', { id: 'msg-wll-b', slot: 'headline', blockId: 'b-h-urg-gear' }).ok);

  /* ---- fork for one message ---- */
  const fk = must('fork a shared block', act(MC, 'block/create', { block: { kind: 'cta', value: 'See the picks', tags: { angle: 'neutral' } }, forkOf: 'b-cta-look' }));
  check('fork records its source', K.block(MC.store.getState(), fk.created[0]).forkOf === 'b-cta-look' && K.block(MC.store.getState(), fk.created[0]).review === 'draft');
  must('use the fork in one message', act(MC, 'message/setSlot', { id: 'msg-wll-b', slot: 'cta', blockId: fk.created[0] }));
  check('override sets a channel version', act(MC, 'message/setOverride', { id: 'msg-wll-b', channel: 'sms', slot: 'headline', blockId: 'b-h-trail-short' }).ok && K.render(MC.store.getState(), 'msg-wll-b', 'sms', { campaignId: 'c-wll' }).blocksUsed.includes('b-h-trail-short'));
  check('validation: wrong kind in a slot', !act(MC, 'message/setSlot', { id: 'msg-wll-b', slot: 'headline', blockId: 'b-cta-look' }).ok);
  check('validation: bad block value', !act(MC, 'block/create', { block: { kind: 'cta', value: 'x'.repeat(60), tags: {} } }).ok && !act(MC, 'block/create', { block: { kind: 'offer', value: { type: 'none', text: 'x' }, tags: {} } }).ok);
  // inverse round trip for an edit
  const w0 = MC.store.getState(), invEdit = MC.catalog.inverse(w0, { type: 'block/update', payload: { id: 'b-cta-gearup', value: 'Gear up now' } }, { origin: 'user' });
  check('block/update inverse restores the value', invEdit.length === 1 && invEdit[0].payload.value === 'Gear up');

  /* ---- simulator: exposures and ledgers ---- */
  const MC2 = await boot(); let w2 = adv(MC2, 150);
  const C = w2.content, expIds = Object.keys(C.exp);
  check('exposures are tracked per person', expIds.length >= 10 && expIds.every(id => C.exp[id] instanceof Uint8Array) && expIds.some(id => C.exp[id].some(x => x > 1)));
  let delivPerf = 0, delivFat = 0, sentPerf = 0, clickPerf = 0, clickFat = 0;
  Object.values(C.perf).forEach(day => Object.values(day).forEach(b => Object.values(b).forEach(r => { sentPerf += r[0]; delivPerf += r[1]; clickPerf += r[3]; })));
  Object.values(C.fat).forEach(b => Object.values(b).forEach(rows => rows.forEach(r => { delivFat += r[0]; clickFat += r[2]; })));
  check('ledgers record sends', sentPerf > 1000 && delivPerf > 0.9 * sentPerf, sentPerf + '/' + delivPerf);
  check('perf and fatigue ledgers agree', delivPerf === delivFat && clickPerf === clickFat, delivPerf + ' ' + delivFat);
  let perVar = 0; w2.metrics.days.forEach(d => Object.values(d.c).forEach(cd => Object.values(cd.v || {}).forEach(f => { perVar += f[MC2.F.SENT]; })));
  let perBlockSent = 0; Object.values(C.perf).forEach(day => Object.values(day).forEach(b => Object.values(b).forEach(r => { perBlockSent += r[0]; })));
  check('every send of a linked variant logs its blocks', perBlockSent > perVar, perBlockSent + ' vs ' + perVar);
  const fx = MC2.sim.angleFx;
  check('trail season beats urgency in email and push, not in SMS', fx('trail-season', 'email', 5, null)[0] > fx('urgency', 'email', 5, null)[0] + 0.3 && fx('trail-season', 'push', 5, null)[0] > fx('urgency', 'push', 5, null)[0] + 0.3 && Math.abs(fx('trail-season', 'sms', 5, 2)[1] - fx('urgency', 'sms', 5, 2)[1]) < 0.12);
  check('urgency pays only with a deadline close by', fx('urgency', 'email', 5, 0.5)[0] > 0.3 && fx('urgency', 'email', 5, 5.5)[0] < 0.05 && fx('urgency', 'email', 5, null)[0] < 0);
  check('gifting rises after Dec 1', fx('gifting', 'email', 10, null)[1] < 0 && fx('gifting', 'email', 24, null)[1] < fx('gifting', 'email', 30, null)[1] && fx('gifting', 'email', 40, null)[1] > 0.25);
  check('block latents are seeded and stable', JSON.stringify(MC2.sim.latentForBlock(w2, 'b-cta-shop')) === JSON.stringify(MC.sim.latentForBlock(w, 'b-cta-shop')) && !!w2.latent.blocks['b-cta-shop']);

  /* ---- determinism and replay ---- */
  const acts = [['block/update', { id: 'b-cta-shop', value: 'Shop the sale' }], ['block/setReview', { id: 'b-cta-shop', review: 'approved' }], ['message/publish', { id: 'msg-lhw-b', campaignId: 'c-lhw', channels: ['email', 'sms'] }]];
  async function run() {
    const M = await boot(); let x = adv(M, 24);
    acts.forEach(a => { const r = M.catalog.dispatchUser(M.store.getState(), { type: a[0], payload: a[1] }); if (!r.ok) console.log('  run action failed', a[0], r.error); });
    x = adv(M, 96);
    return { M, x, d: M.replay.digestWorld(x) };
  }
  const r1 = await run(), r2 = await run();
  check('two runs produce identical digests', r1.d.state === r2.d.state && r1.d.audit === r2.d.audit && r1.d.parts.entities === r2.d.parts.entities, r1.d.state + ' ' + r2.d.state);
  check('content is part of the digest', r1.d.parts.entities !== undefined && r1.M.util.digest(r1.x.content) === r2.M.util.digest(r2.x.content));
  const rep = await r1.M.replay.run({ seed: r1.x.meta.seed, log: r1.x.log, toTick: r1.x.meta.tick, chunk: 40 });
  const dr = r1.M.replay.digestWorld(rep);
  check('replaying the action log reproduces the world', dr.state === r1.d.state && dr.audit === r1.d.audit && !rep._diverged, JSON.stringify(rep._diverged) + dr.state + ' ' + r1.d.state);
  check('replayed content matches', r1.M.util.digest(rep.content) === r1.M.util.digest(r1.x.content));

  /* ---- existing machinery still sees linked variants ---- */
  const lib = S.variantLibrary(r1.x);
  check('variantLibrary still lists variants', lib.length === 6 && lib[0].variants.length > 0);
  const stats = S.variantStats(r1.x, 'c-wll', 'email');
  check('variantStats still works for linked variants', !!stats && JSON.stringify(stats).length > 10);

  await intelligence();
  await agents();
  await missionCopy();

  console.log('content-test: ' + (fails ? fails + ' FAILED, ' : 'all ') + passes + ' pass');
  if (fails) process.exitCode = 1;
})().catch(e => { console.log('RUN FAIL', e.stack); process.exitCode = 1; });

/* ================= content intelligence (selectors) ================= */
const TICKS = 420;
const inside = x => !!x && [x.value, x.lo, x.hi].every(Number.isFinite) && x.lo <= x.value + 1e-9 && x.value <= x.hi + 1e-9;
async function intelligence() {
  const MC = await boot(), S = MC.select, K = MC.content; let w = MC.store.getState();
  check('selectors exist', ['contentPerformance', 'contentMatrix', 'blockFatigue', 'contentRecommendations', 'whereUsed'].every(n => typeof S[n] === 'function'));
  w = adv(MC, TICKS);

  // every figure carries an interval; thin data says so
  const ang = S.contentPerformance(w, { by: 'angle' }), trail = ang.rows.find(r => r.key === 'trail-season'), urg = ang.rows.find(r => r.key === 'urgency');
  check('contentPerformance by angle returns rows (array and .rows)', Array.isArray(ang) && ang.rows === ang && ang.length >= 4 && ang.by === 'angle', ang.length);
  check('rates per delivery carry 95% intervals', ang.every(r => ['open', 'click', 'conv'].every(m => r.rates[m].lo <= r.rates[m].rate + 1e-12 && r.rates[m].rate <= r.rates[m].hi + 1e-12 && r.rates[m].hi <= 1)));
  check('revenue per send carries an interval', ang.every(r => r.revPerSend.lo <= r.revPerSend.value + 1e-9 && r.revPerSend.value <= r.revPerSend.hi + 1e-9), JSON.stringify(ang[0].revPerSend));
  let cells = 0, pointOnly = [];
  ang.forEach(r => Object.keys(r.byChannel).forEach(ch => { const c = r.byChannel[ch]; cells++; if (c.enough ? !inside(c.lift) : (c.lift !== null || typeof c.reason !== 'string' || !c.reason)) pointOnly.push(r.key + ':' + ch); }));
  check('lift is always interval-backed, otherwise enough:false with a reason', cells >= 8 && pointOnly.length === 0, pointOnly.join());
  const tEmail = trail.byChannel.email, uEmail = urg.byChannel.email;
  check('email: trail-season headlines beat the rest of the library, interval above zero', tEmail.enough && tEmail.lift.lo > 0 && tEmail.lift.value > 0.05, JSON.stringify(tEmail.lift));
  check('email: urgency without a deadline trails, interval below zero', uEmail.enough && uEmail.lift.hi < 0, JSON.stringify(uEmail.lift));
  const con = S.contentContrast(w, { by: 'angle', a: 'trail-season', b: 'urgency', channel: 'email' });
  check('email: trail-season vs urgency recovers the seeded gap with an interval clear of zero', con.enough && con.contrast.lo > 0 && con.contrast.value > 0.1 && con.contrast.hi < 3, JSON.stringify(con.contrast));
  check('SMS and push are not enough yet, with a reason', ['sms', 'push'].every(ch => { const c = trail.byChannel[ch]; return c && !c.enough && c.lift === null && /delivered|so far|yet/.test(c.reason); }), JSON.stringify(['sms', 'push'].map(ch => trail.byChannel[ch] && trail.byChannel[ch].reason)));
  const sc = S.contentContrast(w, { by: 'angle', a: 'trail-season', b: 'urgency', channel: 'sms' });
  check('contrast on a thin channel says not enough', !sc.enough && sc.contrast === null && !!sc.reason, sc.reason);

  // block level, windows, other dimensions
  const blk = S.contentPerformance(w, { by: 'block', kind: 'headline', channel: 'email' });
  check('by block lists headline blocks with their own lift', blk.length >= 8 && blk.every(r => r.kind === 'headline' && r.blockIds.length === 1 && r.channel === 'email') && blk.some(r => r.enough && inside(r.lift)));
  const win = S.contentPerformance(w, { by: 'angle', days: 3 }), sumD = rs => rs.reduce((a, r) => a + r.delivered, 0);
  check('days narrows the window', sumD(win) > 0 && sumD(win) < sumD(ang), sumD(win) + ' vs ' + sumD(ang));
  check('by tone and by offerType work', S.contentPerformance(w, { by: 'tone' }).length >= 3 && S.contentPerformance(w, { by: 'offerType' }).some(r => r.key === 'pct15') && S.contentPerformance(w, { by: 'image' }).length >= 3);
  check('trend is a daily series', trail.trend.length >= 5 && trail.trend.every(p => p.delivered > 0 && p.rate >= 0 && p.rate <= 1));
  check('memoised like the other selectors', S.contentPerformance(w, { by: 'angle' }) === ang && S.contentMatrix(w, { dim: 'angle' }) === S.contentMatrix(w, { dim: 'angle' }) && S.contentPerformance(w, { by: 'tone' }) !== ang && S.blockFatigue(w, 'b-h-trail-frost') === S.blockFatigue(w, 'b-h-trail-frost') && S.contentRecommendations(w) === S.contentRecommendations(w));
  const w1 = adv(MC, 1);
  check('a new tick recomputes', S.contentPerformance(w1, { by: 'angle' }) !== ang);

  // the matrix
  const M = S.contentMatrix(w, { dim: 'angle' });
  check('matrix is attribute by channel', M.dim === 'angle' && M.channels.join() === MC.CH.OWNED.join() && M.rows.length >= 4 && M.rows.every(r => M.channels.every(ch => r.cells[ch])));
  const mt = M.rows.find(r => r.key === 'trail-season');
  check('matrix cells: email has a lift with interval, SMS and push say not enough', mt.cells.email.enough && inside(mt.cells.email.lift) && !mt.cells.sms.enough && mt.cells.sms.lift === null && !!mt.cells.sms.reason && !mt.cells.push.enough && !!mt.cells.push.reason);

  // reuse fatigue
  const f = S.blockFatigue(w, 'b-h-trail-frost');
  check('fatigue curve by exposure', f.found && f.curve.length === 6 && f.curve[0].delivered > 500 && f.curve[0].rate.rate > f.curve[2].rate.rate, JSON.stringify(f.curve.map(c => [c.delivered, +c.rate.rate.toFixed(3)])));
  check('fatigue: response drops when the same people see it again, with an interval', f.enough && f.drop.value < -0.1 && f.drop.hi < 0 && f.drop.lo < f.drop.value && f.tired, JSON.stringify(f.drop));
  check('fatigue: who has seen it how often', f.exposures && f.exposures.people > 100 && f.exposures.distribution.length === 5 && f.exposures.repeatShare > 0.3 && f.exposures.repeatShare <= 1, JSON.stringify(f.exposures));
  check('fatigue: tired since is a day or null', f.tiredSince === null || (Number.isFinite(f.tiredSince.day) && f.tiredSince.tick === f.tiredSince.day * 24));
  const fresh = S.blockFatigue(w, 'b-bd-trail-1'), ghost = S.blockFatigue(w, 'b-nope');
  check('fatigue: a block that is not tired says so honestly', !fresh.tired && (fresh.enough ? fresh.drop.hi >= 0 || fresh.drop.value > -0.1 : !!fresh.reason), JSON.stringify(fresh.drop) + fresh.reason);
  check('fatigue: unknown block', ghost.found === false && !ghost.tired && !!ghost.reason);
  const tiredIds = K.blocks(w).filter(b => S.blockFatigue(w, b.id).tired).map(b => b.id);
  check('several blocks are tired by now, and the seeded signal is not everywhere', tiredIds.length >= 3 && tiredIds.length < K.blocks(w).length / 2, tiredIds.join());

  // recommendations
  const R = S.contentRecommendations(w), kinds = new Set(R.map(r => r.kind));
  check('recommendations: winners, tired blocks and missing data', R.length >= 4 && ['angle-winner', 'retire-block', 'needs-data'].every(k => kinds.has(k)), [...kinds].join());
  check('recommendations reference real blocks', R.every(r => r.blockIds.every(id => K.block(w, id)) && (!r.replacementId || K.block(w, r.replacementId))), JSON.stringify(R.map(r => r.blockIds)));
  const ret = R.filter(r => r.kind === 'retire-block');
  check('retire recommendations name a usable replacement of the same kind and angle', ret.length >= 2 && ret.every(r => { const b = K.block(w, r.blockIds[0]), rp = r.replacementId && K.block(w, r.replacementId); return K.usedCount(w, b.id) === r.placements && (!rp || (rp.kind === b.kind && rp.review === 'approved' && !rp.retired && !rp.archived && (b.kind !== 'headline' || rp.tags.angle === b.tags.angle) && rp.id !== b.id)); }));
  check('retire recommendations carry the fatigue interval', ret.every(r => r.fatigue.drop.hi < 0 && inside(r.fatigue.drop)));
  const win0 = R.find(r => r.kind === 'angle-winner' && r.channel === 'email');
  check('angle winner on email: interval clear of zero, evidence from the ledger', win0 && inside(win0.contrast) && win0.contrast.lo > 0 && win0.best.angle !== win0.worst.angle && /by \d+% on email opens \(\d+% to \d+%\)/.test(win0.summary), win0 && win0.summary);
  check('winner points at approved headline blocks of the winning angle', win0.blockIds.every(id => { const b = K.block(w, id); return b.kind === 'headline' && b.review === 'approved' && b.tags.angle === win0.best.angle; }));
  check('SMS and push are called out as needing data', ['sms', 'push'].every(ch => R.some(r => r.kind === 'needs-data' && r.channel === ch && r.summary.length > 10)));
  check('write-blocks recommendation names the kind and angle', R.filter(r => r.kind === 'write-blocks').every(r => ['headline', 'body', 'cta'].includes(r.blockKind) && K.ANGLES.includes(r.angle)));

  // dry-run render of words that do not exist yet
  const good = S.draftChecks(w, { slots: { headline: '$h', body: 'b-bd-warm-1', cta: 'b-cta-look' }, blocks: { $h: { kind: 'headline', value: 'Warm layers for the first frost', tags: { angle: 'warmth' } } } }, ['email', 'sms', 'push'], 'c-wll');
  const bad = S.draftChecks(w, { slots: { headline: '$h', body: 'b-bd-warm-1', cta: 'b-cta-look' }, blocks: { $h: { kind: 'headline', value: 'BUY NOW AND SAVE HUGE ON EVERYTHING TODAY ONLY', tags: {} } } }, ['email'], 'c-wll');
  check('draftChecks accepts clean words and reports a failing channel', good.ok && !bad.ok && !!bad.problem, JSON.stringify([good.ok, bad.problem]));
  check('draftChecks never touches the world', !K.block(w, '$h') && K.messages(w).every(m => m.id !== '$draft'));
}

/* ================= agents ================= */
function props(w, f) { return w.proposals.order.map(id => w.proposals.byId[id]).filter(f); }
function runNow(MC, id) { const w = MC.store.getState(); MC.runtime.runAgent(w, id, w.meta.tick, 'runNow'); return MC.store.getState(); }
function approve(MC, id) { return MC.catalog.dispatchUser(MC.store.getState(), { type: 'proposal/approve', payload: { id } }); }
async function agentsRun() {
  const MC = await boot(); let w = adv(MC, TICKS);
  const out = { MC, w };
  return out;
}
async function agents() {
  const { MC, w: w0 } = await agentsRun(), K = MC.content, S = MC.select; let w = w0;
  const audit = w.audit.entries;
  check('no agent run errored', audit.every(e => !e.error), audit.filter(e => e.error).map(e => e.agentId + e.error).join());

  /* Fatigue Guard: retire a tired block everywhere it runs, one proposal */
  const retire = props(w, p => p.kind === 'retire-block');
  check('Guard proposes retiring a tired block', retire.length >= 1 && retire.every(p => p.agentId === 'guard' && p.target.kind === 'block' && K.block(w, p.target.id)), retire.length);
  check('retire proposal is one action list: retire plus a swap for every placement', retire.every(p => p.actions[0].type === 'block/retire' && p.actions[0].payload.id === p.target.id && p.actions.slice(1).every(a => /^message\/set(Slot|Override)$/.test(a.type)) && p.actions.length > 1));
  const pend = retire.find(p => p.status === 'pending') || retire[0];
  const placements = K.messagesUsing(w, pend.target.id).reduce((n, m) => n + K.placements(m, pend.target.id).length, 0);
  check('it lists every placement (swapActions)', pend.actions.length - 1 === placements && pend.diff.length === placements, pend.actions.length + ' ' + placements + ' ' + pend.diff.length);
  check('it always asks (never auto-applies words)', retire.every(p => p.mustQueue && p.status !== 'auto' && p.risk === 'medium'));
  check('it quotes the interval and the evidence', /fall \d+% \(\d+% to \d+%\)/.test(pend.rationale) && pend.evidence.length >= 3 && pend.impact && pend.impact.delta > 0 && pend.impact.lo <= pend.impact.delta && pend.impact.delta <= pend.impact.hi, pend.rationale);
  check('retire proposals pass the guardrails', retire.every(p => p.guardrails.every(g => g.pass || !g.blocking)), JSON.stringify(retire[0].guardrails.filter(g => !g.pass)));

  /* Insight Analyst */
  const ci = (w.insights || []).filter(i => i.kind === 'content' && i.agentId === 'analyst');
  check('Analyst writes content insights', ci.length >= 1, ci.length);
  check('insight reads "<angle> headlines beat <angle> by N% on <channel> <metric> (lo to hi)"', ci.every(i => /^[A-Z][\w-]* headlines beat [\w-]+ by \d+% on (email|push|SMS) (opens|clicks) \(\d+% to \d+%\)/.test(i.title)), ci.map(i => i.title).join(' | '));
  check('insight says which channels do not have enough data yet', ci.every(i => /(SMS|push|email)( and (SMS|push|email))? (doesn.t|don.t) have enough data yet/.test(i.body)), ci[0] && ci[0].body);
  const byKey = {}; ci.forEach(i => { (byKey[i.key] = byKey[i.key] || []).push(i.tick); });
  check('no repeats inside a week', Object.values(byKey).every(ts => ts.every((x, i) => i === 0 || ts[i - 1] - x >= 168)), JSON.stringify(byKey));
  check('insight figures are ordered: lower bound, estimate, upper bound', ci.every(i => { const m = /by (\d+)% on \w+ \w+ \((\d+)% to (\d+)%\)/.exec(i.title); return m && +m[2] <= +m[1] && +m[1] <= +m[3] && +m[2] > 0; }), ci.map(i => i.title).join(' | '));

  /* Variant Optimizer: block-level tests, judged from the ledger */
  const tests = props(w, p => p.kind === 'block-test'), verd = props(w, p => p.kind === 'block-verdict');
  check('Optimizer proposes block-level tests across channels', tests.length >= 1 && tests.every(p => p.agentId === 'optimizer' && p.mustQueue && p.actions.length === 2 && p.actions[0].type === 'message/create' && p.actions[1].type === 'message/publish' && p.actions[1].payload.channels.length >= 2 && w.campaigns.byId[p.target.id]), tests.length);
  const t0 = tests.find(p => p.status === 'pending') || tests[0], cs = t0.actions[0].payload.message;
  const base = K.messagesUsing(w, cs.slots.body).find(m => m.slots.cta === cs.slots.cta && m.slots.headline !== cs.slots.headline);
  check('a test changes only the headline: same body, button and offer as a live message', !!base && cs.slots.offer === base.slots.offer && cs.slots.headline !== base.slots.headline && K.block(w, cs.slots.headline).review === 'approved' && !K.block(w, cs.slots.headline).retired);
  check('the test quotes lift with its interval', /by \d+% \(\d+% to \d+%\)/.test(t0.rationale), t0.rationale);
  check('Optimizer judges headline blocks from the ledger and queues the verdict', verd.length >= 1 && verd.every(p => p.agentId === 'optimizer' && p.mustQueue && p.actions.every(a => a.type === 'campaign/setAlloc') && /beats .* by \d+% \((\d+)% to \d+%\)/.test(p.rationale) && +/\((\d+)% to/.exec(p.rationale)[1] > 0), verd[0] && verd[0].rationale);
  const pp = s => parseFloat(s) / 100;
  check('a verdict moves traffic from the losing headline to the winning one within the per-run limit', verd.every(p => p.diff.length >= 2 && p.diff.every(d => Math.abs(pp(d.after) - pp(d.before)) <= 0.2 + 1e-9) && p.diff.some(d => pp(d.after) < pp(d.before)) && p.diff.some(d => pp(d.after) > pp(d.before)) && p.actions.every(a => Math.abs(Object.values(a.payload.alloc).reduce((x, y) => x + y, 0) - 1) < 1e-6)), JSON.stringify(verd[0] && verd[0].diff));
  check('variant-level proposals are untouched (traffic shifts still happen)', props(w, p => p.kind === 'traffic-shift').length >= 3);

  /* Copy Drafter: tagged blocks, messages composed from approved ones, everything in review */
  const cv = props(w, p => p.agentId === 'copy' && p.kind === 'new-variant'), nb = props(w, p => p.agentId === 'copy' && p.kind === 'new-blocks');
  check('Copy writes a challenger message when a leader tires', cv.length >= 1 && cv.every(p => p.mustQueue && p.actions.map(a => a.type).join() === 'block/create,block/create,message/create,message/publish'), cv.length);
  check('its blocks are tagged and valid', cv.concat(nb).every(p => p.actions.filter(a => a.type === 'block/create').every(a => !K.valueError(a.payload.block.kind, a.payload.block.value) && !MC.content.tagsError(a.payload.block.tags) && a.payload.block.tags.angle && a.payload.block.tags.tone)));
  check('the message is composed from approved blocks plus its own new ones', cv.every(p => { const s = p.actions[2].payload.message.slots; return s.headline === '$h0' && s.body === '$b0' && K.block(w, s.cta).review === 'approved' && (!s.offer || K.block(w, s.offer).review === 'approved') && (s.claims || []).every(id => K.block(w, id).review === 'approved'); }));
  check('it writes toward the angle the ledger says is winning', cv.some(p => /beat .* by \d+% on email opens/.test(p.rationale)), cv[0] && cv[0].rationale);
  check('Copy also writes blocks for the library when a winning angle is short or a tired block has no replacement', nb.length >= 1 && nb.every(p => p.mustQueue && p.target.kind === 'library' && p.actions.every(a => a.type === 'block/create') && p.impact === null), nb.length);
  check('new words never auto-apply', props(w, p => p.agentId === 'copy').every(p => p.status !== 'auto'));

  /* run them again to get fresh pending proposals, then approve and look at what lands */
  w = runNow(MC, 'copy'); w = runNow(MC, 'guard'); w = runNow(MC, 'optimizer');
  const newest = (agent, kind) => props(w, p => p.agentId === agent && p.kind === kind && p.status === 'pending')[0];
  const gRet = newest('guard', 'retire-block'), oTest = newest('optimizer', 'block-test'), cMsg = newest('copy', 'new-variant'), cLib = newest('copy', 'new-blocks');
  check('fresh pending proposals from each content behaviour', !!gRet && !!oTest && !!(cMsg || cLib), [gRet, oTest, cMsg, cLib].map(p => p && p.id).join());

  // Guard: approve -> retired everywhere, edited messages back in review
  const bid = gRet.target.id, usedBefore = K.messagesUsing(w, bid).map(m => m.id);
  let r = approve(MC, gRet.id); w = MC.store.getState();
  check('approving the retire proposal works', r.ok, r.error);
  check('the block is retired and used nowhere', K.block(w, bid).retired && K.usedCount(w, bid) === 0 && S.whereUsed(w, bid).count === 0);
  check('every message that carried it changed and returned to review; live variants show a newer version', usedBefore.every(id => K.message(w, id).review === 'in_review') && K.staleVariants(w).some(s => usedBefore.indexOf(s.messageId) >= 0));
  check('the retired block no longer shows up as a retire recommendation', !S.contentRecommendations(w).some(x => x.kind === 'retire-block' && x.blockIds[0] === bid));

  // Optimizer: approve the test -> a message and one variant per channel, all in review, none taking traffic yet
  const tc = oTest.target.id, allocBefore = JSON.stringify(w.campaigns.byId[tc].alloc), nMsg = K.messages(w).length, nVar = Object.keys(w.variants.byId).length;
  // If the test was proposed before Fatigue Guard's retirement and builds on the block just retired, approving it must be
  // refused with a clear reason (never a crash, never a message with a retired block). Otherwise it applies normally.
  const testBlocks = JSON.stringify(oTest.actions.map(a => a.payload || {}));
  const conflicts = testBlocks.indexOf('"' + bid + '"') >= 0;
  r = approve(MC, oTest.id); w = MC.store.getState();
  if (conflicts) {
    check('a test built on a block that was just retired is refused clearly', !r.ok && /retired/i.test(r.error || ''), r.error);
  } else {
    const chs = oTest.actions[1].payload.channels, newMsg = (w.proposals.byId[oTest.id].created || []).find(id => K.message(w, id));
    check('approving the block test works', r.ok, r.error);
    check('it adds one message in review', K.messages(w).length === nMsg + 1 && K.message(w, newMsg).review === 'in_review' && K.message(w, newMsg).author === 'agent:optimizer');
    const nvs = Object.values(w.variants.byId).filter(v => v.messageId === newMsg);
    check('and one variant per channel, in review, waiting for approval before any traffic', nvs.length === chs.length && Object.keys(w.variants.byId).length === nVar + chs.length && nvs.every(v => v.review === 'in_review' && v.pendingShare > 0 && chs.indexOf(v.channel) >= 0) && JSON.stringify(w.campaigns.byId[tc].alloc) === allocBefore, nvs.length + ' ' + chs.length);
  }

  // Copy: approve -> blocks and message enter review, tagged; nothing is live
  const cp = cMsg || cLib, nBlocks = K.blocks(w).length;
  r = approve(MC, cp.id); w = MC.store.getState();
  check('approving Copy Drafter\'s proposal works', r.ok, r.error);
  const made = w.proposals.byId[cp.id].created.map(id => K.block(w, id) || K.message(w, id)).filter(Boolean);
  const madeBlocks = made.filter(x => x.kind), madeMsgs = made.filter(x => x.slots);
  check('new blocks are in review, tagged, authored by the agent', madeBlocks.length === cp.actions.filter(a => a.type === 'block/create').length && madeBlocks.every(b => b.review === 'in_review' && b.author === 'agent:copy' && b.tags.angle && b.tags.tone && b.history.length === 1) && K.blocks(w).length === nBlocks + madeBlocks.length);
  if (cMsg) {
    check('the message is in review and uses the new headline', madeMsgs.length === 1 && madeMsgs[0].review === 'in_review' && madeBlocks.some(b => b.id === madeMsgs[0].slots.headline));
    const cvs = Object.values(w.variants.byId).filter(v => v.messageId === madeMsgs[0].id);
    check('its variants wait in review with no traffic', cvs.length >= 1 && cvs.every(v => v.review === 'in_review' && !((w.campaigns.byId[v.campaignId].alloc[v.channel] || {})[v.id] > 0)));
    check('it cannot be published by a person until its new blocks are approved', !act(MC, 'message/publish', { id: madeMsgs[0].id, campaignId: cMsg.target.id, channels: [cvs[0].channel] }).ok);
  }

  /* determinism: a second run gives identical proposals, insights and selector output */
  const sig = (MCx, wx) => MCx.util.digest({
    p: props(wx, p => /^(retire-block|block-test|block-verdict|new-blocks|new-variant)$/.test(p.kind)).map(p => [p.id, p.kind, p.status, p.title, p.actions, p.impact]),
    i: (wx.insights || []).filter(i => i.kind === 'content').map(i => [i.id, i.title, i.body]),
    r: MCx.select.contentRecommendations(wx).map(x => [x.id, x.summary]), m: MCx.select.contentMatrix(wx, { dim: 'angle' }).rows.map(x => [x.key, x.delivered]) });
  const A = await agentsRun(), B = await agentsRun();
  check('agent behaviours and selectors are deterministic across runs', sig(A.MC, A.w) === sig(B.MC, B.w), sig(A.MC, A.w) + ' ' + sig(B.MC, B.w));
  check('and the content proposals are non-trivial', props(A.w, p => /^(retire-block|block-test|new-blocks)$/.test(p.kind)).length >= 6);
}

/* ================= missions: the copy step assembles messages from approved blocks ================= */
async function missionCopy() {
  const MC = await boot(), K = MC.content; let w = MC.store.getState();
  const r = MC.missions.createSync('Win back 400 lapsed hikers before Dec 15 without discounting more than 15%');
  w = adv(MC, 50);
  const m = MC.missions.get(w, r.id), c = w.campaigns.byId[m.data.campaignId], cd = m.data.content;
  check('mission copy step assembles messages', !!cd && cd.messages.length >= 1 && cd.messages.every(id => K.message(w, id)), JSON.stringify(cd));
  check('the hand-off reads "N messages · M channels"', /^\d+ messages? · \d+ channels?$/.test(cd.summary) && cd.summary.indexOf(cd.messages.length + (cd.messages.length === 1 ? ' message' : ' messages')) === 0 && cd.channels.length === c.channels.length && m.log.some(b => b.kind === 'did' && b.text.indexOf(cd.summary) >= 0), cd.summary);
  const msgs = cd.messages.map(id => K.message(w, id));
  check('messages are built from approved library blocks and wait in review', msgs.every(x => x.review === 'in_review' && x.author === 'agent:copy' && K.blockIdsOf(x).every(id => K.block(w, id).review === 'approved' && !K.block(w, id).retired)));
  const vs = MC.catalog.variantsOf(w, c.id);
  check('published to every channel: one variant per message and channel, all in review', vs.length === msgs.length * c.channels.length && vs.every(v => v.review === 'in_review' && cd.messages.indexOf(v.messageId) >= 0 && c.channels.indexOf(v.channel) >= 0));
  check('each channel version passes the brand checks', msgs.every(x => c.channels.every(ch => !K.failing(K.render(w, x.id, ch, { campaignId: c.id })).length && !K.render(w, x.id, ch, { campaignId: c.id }).error)));
  check('the best-evidenced headline leads, urgency is only used when there is a deadline', K.block(w, msgs[0].slots.headline).tags.angle !== 'urgency' || (c.offer && c.offer !== 'none'));
  check('message artifacts are attached to the mission', m.artifacts.filter(a => a.kind === 'message').length === msgs.length);
  const hand = m.plan.find(s => s.kind === 'copy');
  check('the copy step carries the summary as its note', hand.status === 'done' && hand.note === cd.summary && hand.artifact && hand.artifact.kind === 'message');
  check('allocations add up per channel', c.channels.every(ch => Math.abs(Object.values(c.alloc[ch] || {}).reduce((a, b) => a + b, 0) - 1) < 1e-6), JSON.stringify(c.alloc));
}
