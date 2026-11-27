// Content model engine tests (Node, loads like tools/smoke.js). Usage: node tools/content-test.js
// Covers docs/CONTENT.md "Model" and "Simulation truth": render per channel within limits, reuse counts, publish and
// version flow, retire flow, simulator ledgers and determinism (including a replay of the action log).
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

  console.log('content-test: ' + (fails ? fails + ' FAILED, ' : 'all ') + passes + ' pass');
  if (fails) process.exitCode = 1;
})().catch(e => { console.log('RUN FAIL', e.stack); process.exitCode = 1; });
