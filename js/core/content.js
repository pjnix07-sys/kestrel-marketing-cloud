/* Marketing Cloud - MC.content: content as data (docs/CONTENT.md). Blocks are channel-neutral pieces (headline, body,
   offer, call to action, image, product, claim, sign-off); a message assembles blocks into slots; every channel
   version is computed from the same source by render(). Variants stay the delivery record: publish renders a message
   for a campaign channel and writes the variant (messageId, channel, renderedVer, pinned block versions).
   Pure helpers only: all state changes are catalog actions (block/*, message/*), see catalog.js.
   world.content = { blocks: {byId, order}, messages: {byId, order}, perf, fat, exp }; the last three are the
   simulator's exposure ledgers (sim.js), never written by actions. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var K = MC.content = MC.content || {};

  K.KINDS = ['headline', 'body', 'offer', 'cta', 'image', 'product', 'claim', 'signoff'];
  K.ANGLES = ['trail-season', 'warmth', 'gifting', 'urgency', 'utility', 'neutral'];
  K.REVIEWS = ['draft', 'in_review', 'changes', 'approved'];
  K.SLOTS = ['headline', 'body', 'offer', 'cta', 'image', 'product', 'claims', 'signoff'];
  K.REQUIRED = ['headline', 'body', 'cta'];
  K.SLOT_KIND = { headline: 'headline', body: 'body', offer: 'offer', cta: 'cta', image: 'image', product: 'product', claims: 'claim', signoff: 'signoff' };
  K.LOCALE = 'en-US';
  K.KIND_LABEL = { headline: 'Headline', body: 'Body', offer: 'Offer', cta: 'Button', image: 'Image', product: 'Product', claim: 'Claim', signoff: 'Sign-off' };
  K.ANGLE_LABEL = { 'trail-season': 'Trail season', warmth: 'Warmth and comfort', gifting: 'Gifting', urgency: 'Urgency with a deadline', utility: 'Practical', neutral: 'Neutral' };

  var EMPTY = { blocks: { byId: {}, order: [] }, messages: { byId: {}, order: [] } };
  function str(x) { return typeof x === 'string' ? x : (x === undefined || x === null ? '' : String(x)); }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function CP() { return MC.copy; }

  /* ---------------- lookups ---------------- */
  K.empty = function () { return { blocks: { byId: {}, order: [] }, messages: { byId: {}, order: [] }, perf: {}, fat: {}, exp: {} }; };
  K.slice = function (w) { return (w && w.content) || EMPTY; };
  K.block = function (w, id) { return K.slice(w).blocks.byId[id] || null; };
  K.message = function (w, id) { return K.slice(w).messages.byId[id] || null; };
  K.blocks = function (w) { var s = K.slice(w).blocks; return s.order.map(function (id) { return s.byId[id]; }).filter(Boolean); };
  K.messages = function (w) { var s = K.slice(w).messages; return s.order.map(function (id) { return s.byId[id]; }).filter(Boolean); };

  // Block as it was at version `ver` (history entry), for pinned renders and the simulator.
  K.blockAt = function (block, ver) {
    if (!block) return null;
    if (ver === undefined || ver === null || ver === block.ver) return block;
    var h = block.history || [];
    for (var i = h.length - 1; i >= 0; i--) {
      if (h[i].ver === ver && h[i].value !== undefined) return { id: block.id, kind: block.kind, value: h[i].value, tags: h[i].tags || block.tags, ver: ver, locale: block.locale };
    }
    return block;
  };
  K.valueOf = function (block, locale, ver) {
    var b = K.blockAt(block, ver);
    if (!b) return null;
    if (locale && locale !== K.LOCALE && block.i18n && block.i18n[locale] !== undefined) return block.i18n[locale];
    return b.value;
  };
  // Plain text of a block for lists and previews.
  K.textOf = function (block) {
    if (!block) return '';
    var v = block.value;
    if (typeof v === 'string') return v;
    if (!isObj(v)) return '';
    if (block.kind === 'offer') return str(v.text);
    if (block.kind === 'image') return str(v.alt) || str(v.imageId);
    if (block.kind === 'product') { var p = CP() && CP().productOf(v.productId); return p ? p.name : str(v.productId); }
    return str(v.text);
  };

  // Which block fills a slot in a channel version: the channel override wins.
  K.slotBlockId = function (message, slot, channel) {
    var o = channel && message.channelOverrides && message.channelOverrides[channel];
    if (o && o[slot]) return o[slot];
    return message.slots[slot] || null;
  };
  // Every placement of a block in a message: [{slot, channel|null}] (channel null = the base slot).
  K.placements = function (message, blockId) {
    var out = [], S = message.slots || {};
    K.SLOTS.forEach(function (slot) {
      if (slot === 'claims') { if ((S.claims || []).indexOf(blockId) >= 0) out.push({ slot: 'claims', channel: null }); }
      else if (S[slot] === blockId) out.push({ slot: slot, channel: null });
    });
    var co = message.channelOverrides || {};
    Object.keys(co).sort().forEach(function (ch) {
      Object.keys(co[ch]).sort().forEach(function (slot) { if (co[ch][slot] === blockId) out.push({ slot: slot, channel: ch }); });
    });
    return out;
  };
  K.blockIdsOf = function (message) {
    var seen = {}, out = [];
    function add(id) { if (id && !seen[id]) { seen[id] = 1; out.push(id); } }
    K.SLOTS.forEach(function (slot) { if (slot === 'claims') (message.slots.claims || []).forEach(add); else add(message.slots[slot]); });
    var co = message.channelOverrides || {};
    Object.keys(co).sort().forEach(function (ch) { Object.keys(co[ch]).sort().forEach(function (slot) { add(co[ch][slot]); }); });
    return out;
  };
  // Messages that use a block (slot or channel override), sorted by id.
  K.messagesUsing = function (w, blockId) {
    return K.messages(w).filter(function (m) { return K.placements(m, blockId).length > 0; }).sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
  };
  K.usedCount = function (w, blockId) { return K.messagesUsing(w, blockId).length; };
  // Reuse counts for every block at once: { blockId: messageCount }.
  K.reuseCounts = function (w) {
    var out = {};
    K.messages(w).forEach(function (m) { K.blockIdsOf(m).forEach(function (id) { out[id] = (out[id] || 0) + 1; }); });
    return out;
  };

  /* ---------------- versions: "newer version available" ---------------- */
  // State of a variant relative to its message: linked variants carry messageId, channel and renderedVer.
  K.variantState = function (w, v) {
    if (!v || !v.messageId) return { linked: false, newer: false };
    var m = K.message(w, v.messageId);
    if (!m) return { linked: true, messageId: v.messageId, missing: true, newer: false, renderedVer: v.renderedVer };
    var stale = [];
    (v.blocks || []).forEach(function (b) {
      var blk = K.block(w, b.id);
      if (blk && blk.ver > b.ver) stale.push(b.id);
    });
    return { linked: true, messageId: m.id, channel: v.channel, renderedVer: v.renderedVer, currentVer: m.ver,
      newer: (v.renderedVer || 0) < m.ver, staleBlocks: stale };
  };
  // Live variants (not retired) with a newer message version waiting.
  K.staleVariants = function (w) {
    var out = [], byId = (w.variants && w.variants.byId) || {};
    Object.keys(byId).sort().forEach(function (id) {
      var v = byId[id];
      if (v.status === 'retired' || !v.messageId) return;
      var s = K.variantState(w, v);
      if (s.newer) out.push({ variantId: id, messageId: v.messageId, channel: v.channel, campaignId: v.campaignId, renderedVer: v.renderedVer, currentVer: s.currentVer, blocks: s.staleBlocks });
    });
    return out;
  };

  /* ---------------- render ---------------- */
  function campCtx(w, cid) {
    var c = cid && w.campaigns && w.campaigns.byId[cid];
    if (!c) return {};
    var out = { today: MC.time.dayOf(w.meta.tick) };
    // an offer end date exists only when the campaign runs an offer
    if (c.offer && c.offer !== 'none' && typeof c.endTick === 'number') { out.endDay = Math.floor((c.endTick - 1) / 24); out.startDay = Math.floor(c.startTick / 24); }
    return out;
  }

  // Resolves a message's slots for a channel into the renderer's parts; errors name the problem.
  K.resolve = function (w, message, channel, opts) {
    opts = opts || {};
    var vers = opts.vers || null, used = [], blockVers = {}, err = null;
    function get(slot, id) {
      if (!id) return null;
      var b = K.block(w, id);
      if (!b) { err = err || ('A block in this message no longer exists (' + id + ').'); return null; }
      var ver = vers && vers[id] !== undefined ? vers[id] : b.ver;
      if (used.indexOf(id) < 0) { used.push(id); blockVers[id] = ver; }
      return { block: b, value: K.valueOf(b, opts.locale, ver) };
    }
    var parts = { claims: [] };
    var h = get('headline', K.slotBlockId(message, 'headline', channel)); parts.headline = h ? str(h.value) : '';
    var b = get('body', K.slotBlockId(message, 'body', channel)); parts.body = b ? str(b.value) : '';
    var c = get('cta', K.slotBlockId(message, 'cta', channel)); parts.cta = c ? str(c.value) : '';
    var o = get('offer', K.slotBlockId(message, 'offer', channel));
    if (o && isObj(o.value)) parts.offer = { type: o.value.type, text: str(o.value.text), short: str(o.value.short) };
    var im = get('image', K.slotBlockId(message, 'image', channel));
    if (im && isObj(im.value)) parts.image = { imageId: im.value.imageId, alt: str(im.value.alt) };
    var pr = get('product', K.slotBlockId(message, 'product', channel));
    if (pr && isObj(pr.value)) parts.productId = pr.value.productId;
    (message.slots.claims || []).forEach(function (id) { var cl = get('claims', id); if (cl) parts.claims.push(str(cl.value)); });
    var so = get('signoff', K.slotBlockId(message, 'signoff', channel)); if (so) parts.signoff = str(so.value);
    parts.tone = (message.tags && message.tags.tone) || null;
    return { parts: parts, used: used, blockVers: blockVers, error: err };
  };

  function limitsFor(ch, fields) {
    var out = {}, L = CP().LIMITS;
    Object.keys(fields).forEach(function (k) { if (L[k]) out[k] = L[k]; });
    return out;
  }

  // render(world, messageId, channel, {profile?, locale?, campaignId?, vers?}) ->
  //   { messageId, channel, ver, fields, blocksUsed, blockVers, tone, offer, productId, checks, limits, info, error? }
  // Fields keep merge tokens (with fallbacks) unless opts.profile (a profile index) is given, which fills them for a preview.
  K.render = function (w, messageId, channel, opts) {
    opts = opts || {};
    var cp = CP(), m = K.message(w, messageId);
    var out = { messageId: messageId, channel: channel, ver: m ? m.ver : 0, fields: {}, blocksUsed: [], blockVers: {}, checks: [], limits: {}, info: {} };
    if (!m) { out.error = 'That message no longer exists.'; return out; }
    if (!cp.FIELDS[channel]) { out.error = 'Unknown channel ' + channel + '.'; return out; }
    var r = K.resolve(w, m, channel, opts);
    out.blocksUsed = r.used; out.blockVers = r.blockVers;
    if (r.error) { out.error = r.error; return out; }
    var c = opts.campaignId && w.campaigns && w.campaigns.byId[opts.campaignId];
    if (!r.parts.productId && c && c.productFocus) r.parts.productId = c.productFocus;
    var rc = cp.renderChannel(r.parts, channel);
    out.tone = r.parts.tone || (c && c.tone) || 'practical';
    out.offer = rc.offer; out.productId = rc.productId;
    out.fields = rc.fields;
    var vlike = { channel: channel, fields: rc.fields, tone: out.tone, offer: rc.offer, productId: rc.productId, campaignId: opts.campaignId };
    var brand = w.guardrails && w.guardrails.brand;
    out.checks = cp.check(vlike, brand, campCtx(w, opts.campaignId));
    out.limits = limitsFor(channel, rc.fields);
    if (channel === 'sms') { var si = cp.smsInfo(cp.expand(rc.fields.sms, vlike)); out.info.sms = { encoding: si.encoding, segments: si.segments, units: si.units }; }
    if (typeof opts.profile === 'number') {
      var shown = cp.render(vlike, w, opts.profile, opts.name !== undefined ? { name: opts.name } : undefined);
      out.preview = shown;
    }
    return out;
  };
  K.failing = function (render) { return (render.checks || []).filter(function (x) { return x.status === 'fail'; }); };

  /* ---------------- publish ---------------- */
  // The variant a publish would update for a campaign channel: the live (non-retired) one made from this message.
  K.variantFor = function (w, messageId, campaignId, channel) {
    var byId = (w.variants && w.variants.byId) || {}, ids = Object.keys(byId).sort();
    for (var i = 0; i < ids.length; i++) {
      var v = byId[ids[i]];
      if (v.messageId === messageId && v.campaignId === campaignId && v.channel === channel && v.status !== 'retired') return v;
    }
    return null;
  };
  // publishPlan(world, {id, campaignId, channels}) -> [{channel, variantId|null, render}]
  K.publishPlan = function (w, p) {
    return (p.channels || []).map(function (ch) {
      var v = K.variantFor(w, p.id, p.campaignId, ch);
      return { channel: ch, variantId: v ? v.id : null, render: K.render(w, p.id, ch, { campaignId: p.campaignId }) };
    });
  };

  /* ---------------- retire: swapping a tired or withdrawn block out of messages ---------------- */
  // Catalog actions that replace `blockId` with `replacementId` in every message that uses it (same kind required).
  // Agents propose these (and then a message/publish per affected campaign channel); nothing is applied here.
  K.swapActions = function (w, blockId, replacementId) {
    var out = [];
    K.messagesUsing(w, blockId).forEach(function (m) {
      K.placements(m, blockId).forEach(function (pl) {
        if (pl.channel) out.push({ type: 'message/setOverride', payload: { id: m.id, channel: pl.channel, slot: pl.slot, blockId: replacementId } });
        else if (pl.slot === 'claims') out.push({ type: 'message/setSlot', payload: { id: m.id, slot: 'claims', blockIds: (m.slots.claims || []).map(function (x) { return x === blockId ? replacementId : x; }) } });
        else out.push({ type: 'message/setSlot', payload: { id: m.id, slot: pl.slot, blockId: replacementId } });
      });
    });
    return out;
  };

  /* ---------------- validation (shared by catalog actions) ---------------- */
  K.valueError = function (kind, value) {
    var cp = CP();
    if (K.KINDS.indexOf(kind) < 0) return 'Unknown block kind.';
    if (kind === 'headline' || kind === 'body' || kind === 'claim' || kind === 'signoff' || kind === 'cta') {
      if (typeof value !== 'string' || !value.trim()) return 'Write the text for this block.';
      var max = kind === 'cta' ? cp.LIMITS.cta : (kind === 'headline' ? 120 : 600);
      if (value.length > max) return 'This ' + K.KIND_LABEL[kind].toLowerCase() + ' is limited to ' + max + ' characters.';
      return null;
    }
    if (!isObj(value)) return 'This block needs structured content.';
    if (kind === 'offer') {
      if (cp.OFFERS.indexOf(value.type) < 0 || value.type === 'none') return 'Pick an offer type.';
      if (typeof value.text !== 'string' || !value.text.trim()) return 'Write the offer sentence.';
      if (value.short !== undefined && typeof value.short !== 'string') return 'The short offer line must be text.';
      return null;
    }
    if (kind === 'image') {
      if (!cp.imageById(value.imageId)) return 'Pick an image.';
      if (value.alt !== undefined && typeof value.alt !== 'string') return 'Alt text must be text.';
      return null;
    }
    if (kind === 'product') return cp.productOf(value.productId) ? null : 'Pick a product.';
    return null;
  };
  K.tagsError = function (tags) {
    var cp = CP();
    if (tags === undefined || tags === null) return null;
    if (!isObj(tags)) return 'Tags must be an object.';
    if (tags.angle !== undefined && K.ANGLES.indexOf(tags.angle) < 0) return 'Unknown angle.';
    if (tags.tone !== undefined && cp.TONES.indexOf(tags.tone) < 0) return 'Unknown tone.';
    if (tags.offerType !== undefined && cp.OFFERS.indexOf(tags.offerType) < 0) return 'Unknown offer type.';
    if (tags.product !== undefined && tags.product !== null && typeof tags.product !== 'string') return 'The product tag must be text.';
    if (tags.season !== undefined && tags.season !== null && typeof tags.season !== 'string') return 'The season tag must be text.';
    return null;
  };
})();
