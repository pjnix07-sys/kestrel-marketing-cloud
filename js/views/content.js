/* Marketing Cloud · Content (#content). MC.views.content.
   Library · Compose · Intelligence (docs/CONTENT.md "Surfaces").
   Content is data: blocks (a headline, a body, an offer...) assemble into messages, and every channel version is rendered
   from the same source by MC.content.render. The Compose draft is local state (mirrored in module memory so it survives
   tab and route changes) and the store never overwrites a dirty draft; only explicit clicks dispatch catalog actions
   (block/update, block/create, message/setSlot, message/setReview, message/publish, proposal/approve). */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};
  MC.content = MC.content || {};

  var EMPTY = [];
  var DOT = '·', DASH = '—', ELL = '…';
  var CHANNELS = ['email', 'sms', 'push', 'social', 'web'];
  var SLOT_ORDER = ['headline', 'body', 'offer', 'cta', 'image', 'product', 'claims', 'signoff'];
  var SLOT_LABEL = { headline: 'Headline', body: 'Body', offer: 'Offer', cta: 'Button', image: 'Image', product: 'Product', claims: 'Claim', signoff: 'Sign-off' };
  var TEXT_SLOTS = { headline: 1, body: 1, cta: 1, signoff: 1, claims: 1, offer: 1 };
  var REVIEW = {
    draft: { label: 'Draft', tone: 'neutral' }, in_review: { label: 'In review', tone: 'agent' },
    changes: { label: 'Changes requested', tone: 'warn' }, approved: { label: 'Approved', tone: 'good' }
  };

  function h() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function has(o, n) { return !!o && typeof o[n] === 'function'; }
  function str(x) { return typeof x === 'string' ? x : (x == null ? '' : String(x)); }
  function cx() { var o = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }
  function K() { return MC.content; }
  function Xr(p) { var C = MC.ui && MC.ui.Xref; return C ? h`<${C} ...${p} />` : null; }
  function CP() { return MC.copy || {}; }
  function assign(a) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) a[k] = s[k]; } return a; }
  function clip(s, n) { s = str(s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + ELL : s; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function chLabel(ch) { return (MC.CH && MC.CH.LABEL && MC.CH.LABEL[ch]) || ({ email: 'Email', sms: 'SMS', push: 'Push', social: 'Social', web: 'Web' }[ch]) || ch; }
  function agentName(id) {
    if (MC.lead && has(MC.lead, 'agentName')) { try { return MC.lead.agentName(id); } catch (e) { /* fall through */ } }
    if (MC.ui && has(MC.ui, 'agentName')) return MC.ui.agentName(id);
    return str(id).replace(/^agent:/, '');
  }
  function tagWords(tags) {
    var out = [], t = tags || {}, KK = K(), cp = CP();
    if (t.angle) out.push((KK.ANGLE_LABEL && KK.ANGLE_LABEL[t.angle]) || t.angle);
    if (t.tone) out.push((cp.TONE_LABEL && cp.TONE_LABEL[t.tone]) || t.tone);
    if (t.offerType && t.offerType !== 'none') out.push((cp.OFFER_LABEL && cp.OFFER_LABEL[t.offerType]) || t.offerType);
    if (t.season) out.push(str(t.season).charAt(0).toUpperCase() + str(t.season).slice(1));
    if (t.product) { var p = cp.productOf && cp.productOf(t.product); out.push(p ? p.name : t.product); }
    return out;
  }
  function tokenText(s) { return str(s).replace(/\{(\w+)(?:\|([^}]*))?\}/g, function (m, n, fb) { return fb != null && fb !== '' ? fb : '[' + n.replace(/_/g, ' ') + ']'; }); }
  function kindLabel(k) { return (K().KIND_LABEL && K().KIND_LABEL[k]) || k; }

  /* ---------------- store access ---------------- */
  function useSel(sel, eq) {
    var safe = function (w) { try { return w ? sel(w) : null; } catch (e) { return null; } };
    return MC.hooks.useSelect(safe, eq);
  }
  function world() { return MC.store && has(MC.store, 'getState') ? MC.store.getState() : null; }
  function dispatch(type, payload) {
    try {
      if (!MC.store || !has(MC.store, 'dispatch')) return { ok: false, error: 'The workspace is still starting up.' };
      return MC.store.dispatch({ type: type, payload: payload }) || { ok: false, error: 'No response.' };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }
  function setFocus(patch) { try { if (MC.uiStore && has(MC.uiStore, 'setFocus')) MC.uiStore.setFocus('content', patch); } catch (e) { /* convenience only */ } }
  function sel(name, w) {
    if (!MC.select || !has(MC.select, name)) return null;
    var args = Array.prototype.slice.call(arguments, 1);
    try { return MC.select[name].apply(null, args); } catch (e) { return null; }
  }
  function selReady(name) { return !!(MC.select && has(MC.select, name)); }
  function Btn(p) {
    var B = MC.ui && MC.ui.Button;
    if (B) return h`<${B} ...${p}>${p.children}<//>`;
    return h`<button type="button" id=${p.id} className="k-btn" onClick=${p.onClick} disabled=${!!p.disabled || !!p.busy}>${p.children}</button>`;
  }
  function Pill(p) { return h`<span className=${cx('ct-pill', 'is-' + (p.tone || 'neutral'))}>${p.children}</span>`; }
  function ReviewPill(p) { var r = REVIEW[p.review] || REVIEW.draft; return h`<${Pill} tone=${r.tone}>${r.label}<//>`; }
  function Scene(p) {
    var S = MC.ui && MC.ui.Scene;
    if (!p.imageId || !S) return null;
    return h`<${S} imageId=${p.imageId} title=${p.title} style=${p.style} />`;
  }
  function Mark(p) { var A = MC.ui && MC.ui.AgentMark; return A ? h`<${A} id=${p.id} size=${p.size || 13} />` : null; }

  /* ---------------- module memory ---------------- */
  var memo = { tab: 'library', msgId: null, q: '', show: 'all', kind: '', angle: '', tone: '', review: '', channel: '', dim: 'angle' };
  var drafts = {};   // msgId -> { slotKey: { text, baseId, baseVer } }

  /* ---------------- block value helpers ---------------- */
  function textOfValue(kind, value) {
    if (kind === 'offer') return value && typeof value === 'object' ? str(value.text) : str(value);
    return typeof value === 'string' ? value : '';
  }
  function withText(blk, text) {
    if (blk.kind === 'offer') return assign({}, blk.value, { text: text });
    return text;
  }
  // Slot key -> block id in a message ('claims:2' addresses the third claim).
  function slotBlockIds(m) {
    var out = [];
    SLOT_ORDER.forEach(function (slot) {
      if (slot === 'claims') (m.slots.claims || EMPTY).forEach(function (id, i) { out.push({ key: 'claims:' + i, slot: 'claims', index: i, id: id }); });
      else if (m.slots[slot]) out.push({ key: slot, slot: slot, id: m.slots[slot] });
    });
    return out;
  }
  // A world whose blocks carry the draft text, for live channel renders. Nothing here touches the store.
  function draftWorld(w, draft) {
    var c = w.content, byId = assign({}, c.blocks.byId), any = false;
    Object.keys(draft || {}).forEach(function (k) {
      var d = draft[k], b = byId[d.baseId];
      if (b && d.text !== textOfValue(b.kind, b.value)) { byId[d.baseId] = assign({}, b, { value: withText(b, d.text) }); any = true; }
    });
    if (!any) return w;
    return assign({}, w, { content: assign({}, c, { blocks: { byId: byId, order: c.blocks.order } }) });
  }

  /* ---------------- word diff ---------------- */
  function wordDiff(a, b) {
    var x = str(a).split(/(\s+)/).filter(Boolean), y = str(b).split(/(\s+)/).filter(Boolean);
    if (x.length > 240 || y.length > 240) return [{ t: 'del', s: str(a) }, { t: 'ins', s: str(b) }];
    var n = x.length, m = y.length, L = [], i, j;
    for (i = 0; i <= n; i++) { L.push(new Array(m + 1)); for (j = 0; j <= m; j++) L[i][j] = 0; }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = [], push = function (t, s) { var l = out[out.length - 1]; if (l && l.t === t) l.s += s; else out.push({ t: t, s: s }); };
    i = 0; j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { push('del', x[i]); i++; }
      else { push('ins', y[j]); j++; }
    }
    while (i < n) push('del', x[i++]);
    while (j < m) push('ins', y[j++]);
    return out;
  }
  function Diff(p) {
    var parts = wordDiff(p.a, p.b);
    return h`<span className="ct-diff">${parts.map(function (x, i) { return x.t === 'same' ? x.s : h`<${x.t === 'ins' ? 'ins' : 'del'} key=${i}>${x.s}<//>`; })}</span>`;
  }

  /* ---------------- performance adapters (MC.select.contentPerformance) ---------------- */
  function pctText(x) { return fin(x) ? (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 100)) + '%' : DASH; }
  function rate(x, dp) { return fin(x) ? (x * 100).toFixed(dp == null ? 1 : dp) + '%' : DASH; }
  function perfRows(w) {
    var rows = sel('contentPerformance', w, { by: 'block' });
    var list = rows && (rows.rows || rows);
    var by = {};
    if (Array.isArray(list)) list.forEach(function (r) { var id = r && r.key; if (id) by[id] = r; });
    return by;
  }
  function perfLine(r) {
    if (!r || !r.enough || !r.lift) return { enough: false, text: r && r.reason ? r.reason : 'Not enough data yet' };
    var L = r.lift, bits = [];
    if (fin(r.delivered)) bits.push((MC.fmt && MC.fmt.num ? MC.fmt.num(r.delivered) : r.delivered) + ' delivered');
    bits.push(pctText(L.value) + ' vs the rest' + (fin(L.lo) && fin(L.hi) ? ' (' + pctText(L.lo) + ' to ' + pctText(L.hi) + ')' : ''));
    return { enough: true, text: bits.join(' ' + DOT + ' '), lift: L };
  }

  /* ---------------- block display ---------------- */
  function BlockValue(p) {
    var b = p.block;
    if (!b) return h`<span className="ct-muted">A block that no longer exists</span>`;
    if (b.kind === 'image') {
      var v = b.value || {};
      return h`<span className="ct-imgval"><span className="ct-thumb"><${Scene} imageId=${v.imageId} title=${v.alt} style=${{ borderRadius: 0 }} /></span><span>${str(v.alt) || str(v.imageId)}</span></span>`;
    }
    if (b.kind === 'offer') {
      var o = b.value || {};
      return h`<span>${str(o.text)}${o.short ? h`<span className="ct-muted"> ${DOT} short: ${o.short}</span>` : null}</span>`;
    }
    return h`<span>${K().textOf(b)}</span>`;
  }

  /* ================= Library ================= */
  function matchesText(s, q) { return str(s).toLowerCase().indexOf(q) >= 0; }

  function Library(p) {
    var React = R();
    var c = useSel(function (w) { return w.content; });
    var vrs = useSel(function (w) { return w.variants; });
    var st = React.useState(0), bump = st[0], setBump = st[1];
    var xs = React.useState(function () { var b = p.openBlock || null; return b; }), open = xs[0], setOpen = xs[1];
    // A link to a block (search, another screen) opens it in the list and brings it into view.
    React.useEffect(function () {
      if (!p.openBlock) return undefined;
      setOpen(p.openBlock);
      var raf = window.requestAnimationFrame(function () { var el = document.getElementById('ct-blk-' + p.openBlock); if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } } });
      return function () { window.cancelAnimationFrame(raf); };
    }, [p.openKey]);
    var w = world(), KK = K();
    function set(patch) { assign(memo, patch); setBump(bump + 1); }
    if (!w || !c) return h`<p className="ct-empty">Loading the library${ELL}</p>`;

    var blocks = KK.blocks(w), msgs = KK.messages(w), reuse = KK.reuseCounts(w);
    var perf = perfRows(w), perfOn = selReady('contentPerformance');
    // channels each message actually runs in (live channel versions), and blocks inherit them
    var msgCh = {};
    Object.keys(w.variants.byId).forEach(function (id) {
      var v = w.variants.byId[id];
      if (v.messageId && v.status !== 'retired') (msgCh[v.messageId] = msgCh[v.messageId] || {})[v.channel] = true;
    });
    function blockChannels(id) {
      var o = {};
      KK.messagesUsing(w, id).forEach(function (m) { Object.keys(msgCh[m.id] || {}).forEach(function (ch) { o[ch] = true; }); });
      return o;
    }
    var q = memo.q.trim().toLowerCase();
    function tagOk(t) {
      t = t || {};
      return (!memo.angle || t.angle === memo.angle) && (!memo.tone || t.tone === memo.tone);
    }
    // Counts are MC.metrics.messages: distinct messages, blocks, and (separately) channel versions.
    var tot = MC.metrics && MC.metrics.messages ? MC.metrics.messages(w) : null;
    var filtered = !!(q || memo.show !== 'all' || memo.kind || memo.angle || memo.tone || memo.review || memo.channel);
    var showBlocks = memo.show !== 'messages', showMsgs = memo.show !== 'blocks' && !memo.kind;
    var rowsB = !showBlocks ? EMPTY : blocks.filter(function (b) {
      if (b.archived) return false;
      if (memo.kind && b.kind !== memo.kind) return false;
      if (!tagOk(b.tags)) return false;
      if (memo.review && b.review !== memo.review) return false;
      if (memo.channel && !blockChannels(b.id)[memo.channel]) return false;
      if (q && !(matchesText(KK.textOf(b), q) || tagWords(b.tags).some(function (t) { return matchesText(t, q); }))) return false;
      return true;
    });
    var rowsM = !showMsgs ? EMPTY : msgs.filter(function (m) {
      if (!tagOk(m.tags)) return false;
      if (memo.review && m.review !== memo.review) return false;
      if (memo.channel && !(msgCh[m.id] || {})[memo.channel]) return false;
      if (q && !(matchesText(m.name, q) || KK.blockIdsOf(m).some(function (id) { return matchesText(KK.textOf(KK.block(w, id)), q); }))) return false;
      return true;
    });

    function sel1(id, label, opts, val, on) {
      return h`<label className="ct-filter"><span>${label}</span>
        <select id=${id} className="ct-select" value=${val} onChange=${function (e) { on(e.target.value); }}>${opts.map(function (o) { return h`<option key=${o[0]} value=${o[0]}>${o[1]}</option>`; })}</select></label>`;
    }
    var kindOpts = [['', 'Any kind']].concat(KK.KINDS.map(function (k) { return [k, kindLabel(k)]; }));
    var angleOpts = [['', 'Any angle']].concat(KK.ANGLES.map(function (a) { return [a, KK.ANGLE_LABEL[a] || a]; }));
    var toneOpts = [['', 'Any tone']].concat((CP().TONES || EMPTY).map(function (t) { return [t, (CP().TONE_LABEL || {})[t] || t]; }));
    var revOpts = [['', 'Any review state']].concat(KK.REVIEWS.map(function (r) { return [r, REVIEW[r].label]; }));
    var chOpts = [['', 'Any channel']].concat(CHANNELS.map(function (ch) { return [ch, chLabel(ch)]; }));
    var showOpts = [['all', 'Messages and blocks'], ['messages', 'Messages only'], ['blocks', 'Blocks only']];

    return h`<div className="ct-lib">
      <div className="ct-filters" role="search">
        <label className="ct-filter ct-filter-q"><span>Search</span>
          <input id="ct-search" className="ct-input" type="search" placeholder="Words, tags, message names" value=${memo.q} onChange=${function (e) { set({ q: e.target.value }); }} /></label>
        ${sel1('ct-f-show', 'Show', showOpts, memo.show, function (v) { set({ show: v }); })}
      </div>
      <${MC.ui.Details} id="ct-more-filters" open=${memo.kind || memo.angle || memo.tone || memo.review || memo.channel ? true : null} summary="More filters (angle is the theme of the copy, tone is its voice)">
        <div className="ct-filters">
        ${sel1('ct-f-kind', 'Kind', kindOpts, memo.kind, function (v) { set({ kind: v }); })}
        ${sel1('ct-f-angle', 'Angle', angleOpts, memo.angle, function (v) { set({ angle: v }); })}
        ${sel1('ct-f-tone', 'Tone', toneOpts, memo.tone, function (v) { set({ tone: v }); })}
        ${sel1('ct-f-review', 'Review', revOpts, memo.review, function (v) { set({ review: v }); })}
        ${sel1('ct-f-channel', 'Channel', chOpts, memo.channel, function (v) { set({ channel: v }); })}
        </div>
      <//>
      <p className="ct-count" role="status" data-messages=${tot ? tot.messages : undefined}>${plural(tot && !filtered ? tot.messages : rowsM.length, 'message')} ${DOT} ${plural(tot && !filtered ? tot.blocks : rowsB.length, 'block')}${tot && !filtered ? ' ' + DOT + ' ' + plural(tot.channelVersions, 'channel version') : (tot ? ' ' + DOT + ' filtered from ' + tot.messages + ' messages and ' + tot.blocks + ' blocks' : '')}${selReady('contentPerformance') ? '' : ' ' + DOT + ' results appear here as soon as there is data'}</p>
      ${rowsM.length ? h`<section aria-label="Messages"><h2 className="ct-h">Messages</h2><p className="ct-meta">A message is one piece of marketing copy; its blocks (headline, body, button, image) are reused across messages.</p>
        <ul className="ct-list">${rowsM.map(function (m) { return h`<${MessageRow} key=${m.id} w=${w} m=${m} chans=${Object.keys(msgCh[m.id] || {})} onOpen=${p.onOpenMessage} />`; })}</ul></section>` : null}
      ${rowsB.length ? h`<section aria-label="Blocks"><h2 className="ct-h">Blocks</h2>
        <ul className="ct-list">${rowsB.map(function (b) {
          return h`<${BlockRow} key=${b.id} w=${w} b=${b} used=${reuse[b.id] || 0} perf=${perf[b.id]} perfOn=${perfOn} open=${open === b.id}
            onToggle=${function () { setOpen(open === b.id ? null : b.id); }} onOpenMessage=${p.onOpenMessage} />`;
        })}</ul></section>` : null}
      ${!rowsB.length && !rowsM.length ? h`<p className="ct-empty">${filtered ? 'Nothing matches. Clear the search or a filter to see more.' : 'No content yet. Ask the Content Writer for a message from Goals, or write one in Compose.'}</p>` : null}
    </div>`;
  }

  function MessageRow(p) {
    var w = p.w, m = p.m, KK = K();
    var used = KK.usedCount ? 0 : 0;
    var places = (p.chans || EMPTY).length;
    var stale = KK.staleVariants ? KK.staleVariants(w).filter(function (s) { return s.messageId === m.id; }).length : 0;
    var stack = slotBlockIds(m).filter(function (s) { return s.slot !== 'image' && s.slot !== 'product'; });
    return h`<li className="ct-row ct-row-msg">
      <div className="ct-row-head">
        <button type="button" className="ct-title" onClick=${function () { p.onOpen(m.id); }}>${m.name}</button>
        <${ReviewPill} review=${m.review} />
      </div>
      <ol className="ct-stack" aria-label="Blocks in this message">${stack.map(function (s) {
        var b = KK.block(w, s.id);
        return h`<li key=${s.key}><span className="ct-k">${SLOT_LABEL[s.slot]}</span><span className="ct-stack-t">${clip(tokenText(KK.textOf(b)), s.slot === 'body' ? 70 : 60)}</span></li>`;
      })}</ol>
      <p className="ct-meta">${tagWords(m.tags).join(' ' + DOT + ' ')}${tagWords(m.tags).length ? ' ' + DOT + ' ' : ''}${places ? 'Running in ' + p.chans.map(chLabel).join(', ') : 'Not running anywhere yet'}${stale ? ' ' + DOT + ' ' + plural(stale, 'channel version') + ' behind' : ''}</p>
      <${Xr} kind="message" id=${m.id} className="ct-xref" />
      <p className="ct-actions"><button type="button" className="ct-link" onClick=${function () { p.onOpen(m.id); }}>Open in Compose</button></p>
    </li>`;
  }

  function BlockRow(p) {
    var b = p.b, w = p.w, perf = perfLine(p.perf);
    var wu = p.open ? sel('whereUsed', w, b.id) : null;
    return h`<li id=${'ct-blk-' + b.id} className=${cx('ct-row', p.b.retired && 'is-retired')}>
      <div className="ct-row-head">
        <span className="ct-k">${kindLabel(b.kind)}</span>
        <div className="ct-val"><${BlockValue} block=${b} /></div>
        <${ReviewPill} review=${b.review} />
      </div>
      <p className="ct-meta">${tagWords(b.tags).join(' ' + DOT + ' ') || 'No tags yet'}${b.retired ? ' ' + DOT + ' Retired' : ''}${b.forkOf ? ' ' + DOT + ' A copy made for one message' : ''}
        ${b.author && b.author.indexOf('agent:') === 0 ? h` ${DOT} Written by ${agentName(b.author.slice(6))}` : null}</p>
      <p className="ct-meta">
        <button type="button" className="ct-link" aria-expanded=${p.open ? 'true' : 'false'} onClick=${p.onToggle}>Used in ${plural(p.used, 'place')}</button>
        ${DOT} <span className=${perf.enough ? '' : 'ct-faint'}>${p.perfOn ? perf.text : 'Results appear here as soon as there is data'}</span>
      </p>
      ${p.open ? h`<div className="ct-where">
        <${Xr} kind="block" id=${b.id} className="ct-xref" />
        ${wu && wu.messages && wu.messages.length ? h`<ul>${wu.messages.map(function (m) {
          return h`<li key=${m.id}><button type="button" className="ct-link" onClick=${function () { p.onOpenMessage(m.id); }}>${m.name}</button>
            <span className="ct-muted"> ${DOT} ${m.placements.map(function (pl) { return SLOT_LABEL[pl.slot].toLowerCase() + (pl.channel ? ' in ' + chLabel(pl.channel) : ''); }).join(', ')}${m.campaigns && m.campaigns.length ? ' ' + DOT + ' ' + plural(m.campaigns.length, 'campaign') : ''}</span></li>`;
        })}</ul>` : h`<p className="ct-muted">${p.used ? 'Loading where this is used' + ELL : 'Not used in any message yet.'}</p>`}
      </div>` : null}
    </li>`;
  }

  /* ================= Compose ================= */
  function channelRenders(w, id, loc) {
    var out = {};
    CHANNELS.forEach(function (ch) {
      var r;
      try { r = K().render(w, id, ch, loc ? { locale: loc } : {}); } catch (e) { r = { fields: {}, checks: [], limits: {}, error: String((e && e.message) || e) }; }
      out[ch] = r;
    });
    return out;
  }
  function shown(w, r, ch) {
    var f = r && r.fields || {};
    var cp = CP();
    if (!r || r.error || !cp.render) return f;
    try { return cp.render({ channel: ch, fields: f, offer: r.offer, productId: r.productId }, w, -1, { name: '' }); } catch (e) { return f; }
  }

  function Preview(p) {
    var f = p.f, ch = p.ch;
    if (ch === 'email') {
      return h`<div className="ct-pv ct-pv-email">
        <p className="ct-pv-subj"><b>${f.subject}</b><span>${f.preheader}</span></p>
        <div className="ct-pv-mail">
          ${f.imageId ? h`<${Scene} imageId=${f.imageId} title=${f.alt} style=${{ borderRadius: 0, height: 74, objectFit: 'cover' }} />` : null}
          <p className="ct-pv-h">${f.headline}</p><p className="ct-pv-b">${clip(f.body, 150)}</p>
          ${f.cta ? h`<span className="ct-pv-cta">${f.cta}</span>` : null}
        </div></div>`;
    }
    if (ch === 'sms') return h`<div className="ct-pv ct-pv-sms"><p className="ct-bubble">${f.sms}</p></div>`;
    if (ch === 'push') return h`<div className="ct-pv ct-pv-push"><p className="ct-push"><b>${f.pushTitle}</b><span>${f.pushBody}</span></p></div>`;
    return h`<div className=${cx('ct-pv', ch === 'web' ? 'ct-pv-web' : 'ct-pv-social')}>
      ${f.imageId ? h`<${Scene} imageId=${f.imageId} title=${f.alt} style=${{ borderRadius: 0, height: ch === 'web' ? 86 : 64, objectFit: 'cover' }} />` : null}
      <p className="ct-pv-h">${f.socialHeadline}</p><p className="ct-pv-b">${f.socialText}</p>
      ${f.cta ? h`<span className="ct-pv-cta">${f.cta}</span>` : null}</div>`;
  }

  function ChannelCard(p) {
    var React = R(), ch = p.ch, r = p.r, st = React.useState(false), data = st[0], setData = st[1];
    var f = shown(p.w, r, ch), checks = (r.checks || EMPTY).filter(function (x) { return x.status !== 'pass'; });
    var lim = r.limits || {}, counts = Object.keys(lim).map(function (k) { var len = str(r.fields[k]).length; return { k: k, len: len, max: lim[k], over: len > lim[k] }; });
    var json = JSON.stringify({ channel: ch, message: r.messageId, version: r.ver, fields: r.fields, offer: r.offer || null, product: r.productId || null }, null, 2);
    return h`<section className="ct-ch" aria-label=${chLabel(ch) + ' version'}>
      <header><h3>${chLabel(ch)}</h3>
        <button type="button" className="ct-link" aria-pressed=${data ? 'true' : 'false'} onClick=${function () { setData(!data); }}>Data</button></header>
      ${r.error ? h`<p className="ct-warn">${r.error}</p>` : (data ? h`<pre className="ct-json" tabIndex="0" aria-label=${'Data the ' + chLabel(ch) + ' version receives'}>${json}</pre>` : h`<${Preview} ch=${ch} f=${f} />`)}
      <p className="ct-ch-meta">${counts.length ? counts.map(function (c) { return h`<span key=${c.k} className=${c.over ? 'is-over' : ''}>${(CP().FIELD_LABEL || {})[c.k] || c.k} ${c.len}/${c.max}</span>`; }) : null}
        ${r.info && r.info.sms ? h`<span>${plural(r.info.sms.segments, 'segment')} ${DOT} ${r.info.sms.encoding}</span>` : null}</p>
      ${checks.length ? h`<ul className="ct-checks">${checks.map(function (x) { return h`<li key=${x.id} className=${'is-' + x.status}><b>${x.label}.</b> ${x.detail}</li>`; })}</ul>`
        : h`<p className="ct-ok">Passes every check</p>`}
    </section>`;
  }

  function SlotPicker(p) {
    var w = p.w, KK = K(), kind = KK.SLOT_KIND[p.slot];
    var cands = KK.blocks(w).filter(function (b) { return b.kind === kind && !b.retired && !b.archived; });
    var cur = p.current;
    return h`<div className="ct-picker" role="listbox" aria-label=${'Choose a ' + SLOT_LABEL[p.slot].toLowerCase()}>
      <ul>${cands.map(function (b) {
        return h`<li key=${b.id}><button type="button" role="option" aria-selected=${b.id === cur ? 'true' : 'false'} className=${cx('ct-opt', b.id === cur && 'is-on')} onClick=${function () { p.onPick(b.id); }}>
          <span className="ct-opt-t"><${BlockValue} block=${b} /></span>
          <span className="ct-opt-m">${tagWords(b.tags).join(' ' + DOT + ' ')}${tagWords(b.tags).length ? ' ' + DOT + ' ' : ''}${REVIEW[b.review] ? REVIEW[b.review].label : ''} ${DOT} used in ${plural(KK.usedCount(w, b.id), 'place')}</span></button></li>`;
      })}${cands.length ? null : h`<li className="ct-muted">No other ${SLOT_LABEL[p.slot].toLowerCase()} blocks yet.</li>`}</ul>
      <button type="button" className="ct-link" onClick=${p.onClose}>Close</button></div>`;
  }

  function SlotRow(p) {
    var React = R(), s = p.s, w = p.w, b = p.b, KK = K();
    var ps = React.useState(false), picking = ps[0], setPicking = ps[1];
    var cur = b ? textOfValue(b.kind, b.value) : '';
    var d = p.draft;
    var dirty = !!d && d.text !== cur;
    var used = b ? KK.usedCount(w, b.id) : 0;
    var moved = !!d && b && d.baseVer !== b.ver;   // someone changed the block underneath a dirty draft
    var rows = s.slot === 'body' ? 4 : (s.slot === 'cta' || s.slot === 'signoff' ? 1 : 2);
    var limit = s.slot === 'cta' ? (CP().LIMITS || {}).cta : (s.slot === 'headline' ? 120 : 600);
    var label = SLOT_LABEL[s.slot];
    var tid = 'ct-slot-' + s.key.replace(':', '-');
    return h`<div className=${cx('ct-slot', dirty && 'is-dirty')}>
      <div className="ct-slot-head">
        <label htmlFor=${tid} className="ct-k">${label}</label>
        <span className="ct-slot-tools">
          ${b ? h`<${ReviewPill} review=${b.review} />` : null}
          <button type="button" className="ct-link" aria-expanded=${picking ? 'true' : 'false'} onClick=${function () { setPicking(!picking); }}>Swap</button>
        </span>
      </div>
      ${b && TEXT_SLOTS[s.slot] ? h`<textarea id=${tid} className="ct-ta" rows=${rows} maxLength=${limit} value=${d ? d.text : cur}
          onChange=${function (e) { p.onEdit(s, b, e.target.value); }}></textarea>`
        : h`<div id=${tid} className="ct-static"><${BlockValue} block=${b} /></div>`}
      <p className="ct-meta">${b ? tagWords(b.tags).join(' ' + DOT + ' ') : ''}${b && used > 1 ? (tagWords(b.tags).length ? ' ' + DOT + ' ' : '') + 'Used in ' + plural(used, 'place') : ''}</p>
      ${moved ? h`<p className="ct-warn" role="status">This block was changed elsewhere while you were editing. Your edit is kept; saving will build on the newer version.</p>` : null}
      ${dirty ? h`<div className="ct-decide" role="group" aria-label=${'Save your change to the ' + label.toLowerCase()}>
        ${used > 1 ? h`<p><b>Used in ${plural(used, 'place')}.</b> Change it everywhere, or only here?</p>` : h`<p>Only this message uses this ${label.toLowerCase()}.</p>`}
        <span className="ct-decide-btns">
          <${Btn} kind="primary" size="sm" onClick=${function () { p.onSave(s, b, d.text, 'everywhere'); }}>${used > 1 ? 'Change everywhere' : 'Save change'}<//>
          ${used > 1 ? h`<${Btn} kind="secondary" size="sm" onClick=${function () { p.onSave(s, b, d.text, 'fork'); }}>Just for this message<//>` : null}
          <${Btn} kind="ghost" size="sm" onClick=${function () { p.onDiscard(s); }}>Discard<//>
        </span></div>` : null}
      ${picking ? h`<${SlotPicker} w=${w} slot=${s.slot} current=${b && b.id} onClose=${function () { setPicking(false); }}
        onPick=${function (id) { setPicking(false); p.onSwap(s, id); }} />` : null}
    </div>`;
  }

  function historyLine(w, m, e) {
    var KK = K(), b = e.blockId ? KK.block(w, e.blockId) : null;
    var who = e.by === 'user' ? 'You' : (str(e.by).indexOf('agent:') === 0 ? agentName(str(e.by).slice(6)) : (e.by || 'Someone'));
    var when = MC.fmt && MC.fmt.rel && fin(e.tick) && w.meta ? MC.fmt.rel(e.tick, w.meta.tick) : '';
    var what, diff = null;
    if (e.kind === 'create') what = 'created the message';
    else if (e.kind === 'edit') what = 'renamed or retagged the message';
    else if (e.kind === 'review') what = 'moved it to ' + (REVIEW[e.review] ? REVIEW[e.review].label.toLowerCase() : e.review);
    else if (e.kind === 'slot') { var nb = KK.block(w, e.blockId); what = 'swapped the ' + (e.slot === 'claims' ? 'claims' : e.slot) + (nb ? ' to “' + clip(KK.textOf(nb), 40) + '”' : ''); }
    else if (e.kind === 'override') what = 'set a ' + chLabel(e.channel) + ' ' + e.slot + (e.blockId ? '' : ' (removed)');
    else if (e.kind === 'block' && b) {
      what = 'edited the ' + kindLabel(b.kind).toLowerCase() + ' “' + clip(KK.textOf(b), 30) + '”';
      var hh = b.history || EMPTY, i;
      for (i = hh.length - 1; i > 0; i--) if (hh[i].tick === e.tick && hh[i].value !== undefined) { diff = { a: textOfValue(b.kind, hh[i - 1].value), b: textOfValue(b.kind, hh[i].value) }; break; }
    } else what = 'changed the message';
    return { key: e.ver + ':' + e.tick + ':' + (e.kind || ''), ver: e.ver, text: who + ' ' + what, when: when, diff: diff };
  }

  var MSG_KEEP = {};
  function Compose(p) {
    var React = R(), KK = K();
    var c = useSel(function (w) { return w.content; });
    var vs = useSel(function (w) { return w.variants; });
    var cs = useSel(function (w) { return w.campaigns; });
    var ps = useSel(function (w) { return w.proposals; });
    var w = world();
    var msgId = p.msgId;
    var m = w && c ? KK.message(w, msgId) : null;
    var st = React.useState(function () { return drafts[msgId] || {}; }), draft = st[0], setDraft0 = st[1];
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var ls = React.useState(''), loc = ls[0], setLoc = ls[1];
    var pc = React.useState(''), campId = pc[0], setCampId = pc[1];
    var pcs = React.useState(null), pubCh = pcs[0], setPubCh = pcs[1];
    var ns = React.useState(false), renaming = ns[0], setRenaming = ns[1];
    var nm = React.useState(''), nameTxt = nm[0], setNameTxt = nm[1];
    function setDraft(next) { drafts[msgId] = next; setDraft0(next); }
    React.useEffect(function () { setDraft0(drafts[msgId] || {}); setMsg(null); setPubCh(null); setCampId(''); setLoc(''); }, [msgId]);
    var debounced = MC.hooks.useDebounced ? MC.hooks.useDebounced(draft, 120) : draft;
    if (!w || !c) return h`<p className="ct-empty">Loading${ELL}</p>`;
    if (!m) return h`<p className="ct-empty">That message no longer exists. Pick another from the library.</p>`;

    var dw = draftWorld(w, debounced);
    var renders = channelRenders(dw, msgId, loc);
    var slots = slotBlockIds(m);
    var locales = {};
    KK.blockIdsOf(m).forEach(function (id) { var b = KK.block(w, id); if (b && b.i18n) Object.keys(b.i18n).forEach(function (l) { locales[l] = 1; }); });
    var localeList = [KK.LOCALE].concat(Object.keys(locales).filter(function (l) { return l !== KK.LOCALE; }));

    function say(r, ok) { setMsg(r && r.ok === false ? { tone: 'crit', text: r.error || 'That did not work.' } : (ok ? { tone: 'good', text: ok } : null)); return r; }
    function onEdit(s, b, text) {
      var next = assign({}, draft);
      if (text === textOfValue(b.kind, b.value)) delete next[s.key]; else next[s.key] = { text: text, baseId: b.id, baseVer: (draft[s.key] && draft[s.key].baseVer) || b.ver };
      setDraft(next);
    }
    function dropDraft(key) { var next = assign({}, draft); delete next[key]; setDraft(next); }
    function onSave(s, b, text, mode) {
      var value = withText(b, text), r;
      if (mode === 'everywhere') {
        r = dispatch('block/update', { id: b.id, value: value, note: 'Edited from Compose' });
        if (r.ok) { dropDraft(s.key); say(r, 'Changed everywhere it is used.'); } else say(r);
        return;
      }
      r = dispatch('block/create', { block: { kind: b.kind, value: value, tags: b.tags }, forkOf: b.id, note: 'Made for ' + m.name });
      if (!r.ok) return say(r);
      var nid = (r.created && r.created[0]) || (r.entityIds && r.entityIds[0]);
      if (!nid) { var all = KK.blocks(world()); nid = all.length ? all[all.length - 1].id : null; }
      var args = s.slot === 'claims'
        ? { id: m.id, slot: 'claims', blockIds: (m.slots.claims || EMPTY).map(function (x, i) { return i === s.index ? nid : x; }) }
        : { id: m.id, slot: s.slot, blockId: nid };
      var r2 = dispatch('message/setSlot', args);
      if (r2.ok) { dropDraft(s.key); say(r2, 'Saved as a new block used only in this message.'); } else say(r2);
    }
    function onSwap(s, id) {
      var args = s.slot === 'claims'
        ? { id: m.id, slot: 'claims', blockIds: (m.slots.claims || EMPTY).map(function (x, i) { return i === s.index ? id : x; }) }
        : { id: m.id, slot: s.slot, blockId: id };
      dropDraft(s.key);
      say(dispatch('message/setSlot', args), 'Swapped in.');
    }
    function review(to) { say(dispatch('message/setReview', { id: m.id, review: to }), null); }

    // publish
    var camps = cs ? cs.order.map(function (id) { return cs.byId[id]; }).filter(function (x) { return x && x.status !== 'completed' && x.status !== 'archived'; }) : EMPTY;
    var camp = camps.filter(function (x) { return x.id === campId; })[0] || null;
    var pubChans = camp ? camp.channels.filter(function (ch) { return CHANNELS.indexOf(ch) >= 0; }) : EMPTY;
    var chosen = camp ? (pubCh || pubChans).filter(function (ch) { return pubChans.indexOf(ch) >= 0; }) : EMPTY;
    var plan = camp && chosen.length && has(KK, 'publishPlan') ? KK.publishPlan(w, { id: m.id, campaignId: camp.id, channels: chosen }) : EMPTY;
    var stale = has(KK, 'staleVariants') ? KK.staleVariants(w).filter(function (x) { return x.messageId === m.id; }) : EMPTY;
    var anyDirty = Object.keys(draft).some(function (k) { var d = draft[k], b = KK.block(w, d.baseId); return b && d.text !== textOfValue(b.kind, b.value); });
    function publish() {
      var r = dispatch('message/publish', { id: m.id, campaignId: camp.id, channels: chosen });
      say(r, r.ok ? 'Published ' + plural(chosen.length, 'channel version') + ' to ' + camp.name + '.' : null);
    }

    // agents' suggestions for this message
    var bset = {}; KK.blockIdsOf(m).forEach(function (id) { bset[id] = 1; });
    var open = (ps && ps.order ? ps.order : EMPTY).map(function (id) { return ps.byId[id]; }).filter(function (x) {
      return x && x.status === 'pending' && (x.actions || EMPTY).some(function (a) {
        var t = a.type || '', pl = a.payload || {};
        if (t.indexOf('block/') !== 0 && t.indexOf('message/') !== 0) return false;
        return pl.id === m.id || (pl.id && bset[pl.id]) || (pl.blockId && bset[pl.blockId]) || (pl.replacementId && bset[pl.replacementId]);
      });
    });

    var hist = (m.history || EMPTY).slice(-8).reverse().map(function (e) { return historyLine(w, m, e); });
    var next = { draft: [['in_review', 'Send to review']], in_review: [['approved', 'Approve'], ['changes', 'Ask for changes']], changes: [['in_review', 'Send to review']], approved: [['draft', 'Move back to draft']] }[m.review] || EMPTY;

    return h`<div className="ct-compose">
      <header className="ct-c-head">
        <div>
          ${renaming
            ? h`<form className="ct-rename" onSubmit=${function (e) { e.preventDefault(); var r = dispatch('message/update', { id: m.id, name: nameTxt }); if (r.ok) setRenaming(false); else say(r); }}>
                <label className="ct-sr" htmlFor="ct-name">Message name</label>
                <input id="ct-name" className="ct-input" value=${nameTxt} maxLength="80" onChange=${function (e) { setNameTxt(e.target.value); }} />
                <${Btn} kind="primary" size="sm" type="submit" onClick=${null}>Save<//><${Btn} kind="ghost" size="sm" onClick=${function () { setRenaming(false); }}>Cancel<//></form>`
            : h`<h2 className="ct-msgname">${m.name} <button type="button" className="ct-link" onClick=${function () { setNameTxt(m.name); setRenaming(true); }}>Rename</button></h2>`}
          <${Xr} kind="message" id=${m.id} className="ct-xref" />
          <p className="ct-meta">Version ${m.ver} ${DOT} ${tagWords(m.tags).join(' ' + DOT + ' ')}${m.author && m.author.indexOf('agent:') === 0 ? ' ' + DOT + ' Written by ' + agentName(m.author.slice(6)) : ''}</p>
        </div>
        <div className="ct-c-review"><${ReviewPill} review=${m.review} />
          ${next.map(function (n) { return h`<${Btn} key=${n[0]} kind=${n[0] === 'approved' ? 'primary' : 'secondary'} size="sm" onClick=${function () { review(n[0]); }}>${n[1]}<//>`; })}
          ${localeList.length > 1 ? h`<label className="ct-filter"><span>Language</span><select className="ct-select" value=${loc || KK.LOCALE} onChange=${function (e) { setLoc(e.target.value === KK.LOCALE ? '' : e.target.value); }}>${localeList.map(function (l) { return h`<option key=${l} value=${l}>${l}</option>`; })}</select></label>` : null}
        </div>
      </header>
      ${msg ? h`<p className=${'ct-msg is-' + msg.tone} role=${msg.tone === 'crit' ? 'alert' : 'status'}>${msg.text}</p>` : null}

      ${open.length ? h`<section className="ct-notes" aria-label="Suggestions from your agents">${open.map(function (x) {
        return h`<div key=${x.id} className="ct-note"><span className="ct-note-by"><${Mark} id=${x.agentId} />${agentName(x.agentId)}</span>
          <p><b>${x.title}</b>${x.summary || x.why ? h` <span className="ct-muted">${clip(x.summary || x.why, 160)}</span>` : null}</p>
          <${Btn} kind="secondary" size="sm" onClick=${function () { say(dispatch('proposal/approve', { id: x.id }), 'Approved. The agent applies it now.'); }}>Approve<//></div>`;
      })}</section>` : null}

      <div className="ct-grid">
        <section className="ct-edit" aria-label="Edit the message once">
          <h3 className="ct-h">Write it once</h3>
          ${slots.map(function (s) {
            var b = KK.block(w, s.id);
            return h`<${SlotRow} key=${s.key + ':' + s.id} s=${s} b=${b} w=${w} draft=${draft[s.key]} onEdit=${onEdit} onSave=${onSave} onDiscard=${dropDraft} onSwap=${onSwap} />`;
          })}
          ${anyDirty ? h`<p className="ct-meta">Previews on the right already include your unsaved edits.</p>` : null}
        </section>
        <section className="ct-versions" aria-label="Channel versions">
          <${MC.ui.Details} id="ct-versions-details" summary="Preview by channel (each channel gets its own version, rendered from this message)">
            <div className="ct-chans">${CHANNELS.map(function (ch) { return h`<${ChannelCard} key=${ch} ch=${ch} r=${renders[ch]} w=${dw} />`; })}</div>
          <//>
        </section>
      </div>

      <section className="ct-publish" aria-label="Publish to a campaign">
        <h3 className="ct-h">Put it to work</h3>
        ${stale.length ? h`<p className="ct-meta">${plural(stale.length, 'live channel version')} still run an older version of this message. Publishing to the same campaign updates them.</p>` : null}
        <div className="ct-pub-row">
          <label className="ct-filter"><span>Campaign</span>
            <select id="ct-camp" className="ct-select" value=${campId} onChange=${function (e) { setCampId(e.target.value); setPubCh(null); }}>
              <option value="">Choose a campaign</option>${camps.map(function (x) { return h`<option key=${x.id} value=${x.id}>${x.name}</option>`; })}</select></label>
          ${camp ? h`<fieldset className="ct-chk"><legend>Channels</legend>${pubChans.map(function (ch) {
            var on = chosen.indexOf(ch) >= 0;
            return h`<label key=${ch}><input type="checkbox" checked=${on} onChange=${function () { setPubCh(on ? chosen.filter(function (x) { return x !== ch; }) : chosen.concat([ch])); }} /> ${chLabel(ch)}</label>`;
          })}</fieldset>` : null}
        </div>
        ${plan.length ? h`<ul className="ct-plan">${plan.map(function (x) {
          var v = x.variantId && w.variants.byId[x.variantId];
          var bad = (x.render.checks || EMPTY).filter(function (k) { return k.status === 'fail'; })[0];
          return h`<li key=${x.channel}><b>${chLabel(x.channel)}</b> ${DOT} ${v ? 'replaces the live version “' + v.name + '” (it runs message version ' + (v.renderedVer || '?') + ', this is ' + m.ver + ')' : 'adds a new channel version'}${bad ? h` <span className="ct-warn">${bad.label}: ${bad.detail}</span>` : null}</li>`;
        })}</ul>` : null}
        <p className="ct-actions"><${Btn} kind="primary" id="ct-publish" disabled=${!camp || !chosen.length || anyDirty || m.review !== 'approved'} onClick=${publish}>${camp && chosen.length ? 'Publish ' + plural(chosen.length, 'channel version') : 'Publish to campaign'}<//>
          <span className="ct-meta">${anyDirty ? 'Save or discard your edits first.' : (m.review !== 'approved' ? 'Approve the message first.' : (camp ? '' : 'Pick a campaign to see what changes.'))}</span></p>
      </section>

      <section className="ct-history" aria-label="Version history">
        <${MC.ui.Details} id="ct-history-details" summary="Version history">
        <ol>${hist.map(function (e) {
          return h`<li key=${e.key}><span className="ct-ver num">v${e.ver}</span><span>${e.text}${e.when ? h` <span className="ct-muted">${DOT} ${e.when}</span>` : null}${e.diff ? h`<br /><${Diff} a=${e.diff.a} b=${e.diff.b} />` : null}</span></li>`;
        })}</ol>
        <//>
      </section>
    </div>`;
  }

  /* ================= Intelligence ================= */
  function Placeholder(p) { return h`<p className="ct-ph">${p.children}</p>`; }

  function liftCell(cell) {
    if (!cell || !cell.enough || !cell.lift) return { cls: 'is-none', main: DASH, sub: 'not enough data yet', title: cell && cell.reason || '' };
    var L = cell.lift, clear = L.lo > 0 || L.hi < 0;
    return { cls: clear ? (L.value > 0 ? 'is-up' : 'is-down') : 'is-flat', main: pctText(L.value), sub: pctText(L.lo) + ' to ' + pctText(L.hi), title: '' };
  }

  function Matrix(p) {
    var DIMS = [['angle', 'Angle'], ['tone', 'Tone'], ['offerType', 'Offer'], ['image', 'Image']];
    var w = world();
    var data = useSel(function (x) { return sel('contentMatrix', x, { dim: p.dim }); });
    var rows = data && (data.rows || data.cells && data.cells.rows || (Array.isArray(data) ? data : null));
    var chans = (data && data.channels) || CHANNELS;
    return h`<section className="ct-int" aria-label="What works where">
      <div className="ct-int-head"><h2 className="ct-h">What works where</h2>
        <label className="ct-filter"><span>Compare by</span><select id="ct-dim" className="ct-select" value=${p.dim} onChange=${function (e) { p.onDim(e.target.value); }}>${DIMS.map(function (d) { return h`<option key=${d[0]} value=${d[0]}>${d[1]}</option>`; })}</select></label></div>
      ${!selReady('contentMatrix') ? h`<${Placeholder}>The comparison appears here once results are in. Nothing is invented in the meantime.<//>`
        : !rows || !rows.length ? h`<${Placeholder}>No results to compare yet.<//>`
        : h`<div className="ct-scroll"><table className="ct-matrix"><caption className="ct-sr">Lift against the channel average, with its 95% interval</caption>
            <thead><tr><th scope="col">${(DIMS.filter(function (d) { return d[0] === p.dim; })[0] || DIMS[0])[1]}</th>${chans.map(function (ch) { return h`<th key=${ch} scope="col">${chLabel(ch)}</th>`; })}</tr></thead>
            <tbody>${rows.map(function (r) {
              var label = r.label || (K().ANGLE_LABEL && K().ANGLE_LABEL[r.key]) || (CP().TONE_LABEL && CP().TONE_LABEL[r.key]) || (CP().OFFER_LABEL && CP().OFFER_LABEL[r.key]) || r.key;
              return h`<tr key=${r.key || label}><th scope="row">${label}</th>${chans.map(function (ch) {
                var cell = r.cells ? r.cells[ch] : null, v = liftCell(cell);
                return h`<td key=${ch} title=${v.title} className=${'ct-cell ' + v.cls}><b>${v.main}</b><span>${v.sub}</span></td>`;
              })}</tr>`;
            })}</tbody></table></div>
          <p className="ct-meta">Lift is against the average for that channel. Shaded cells have an interval clear of zero; faded cells do not have enough sends to say.</p>`}
    </section>`;
  }

  function Curve(p) {
    var pts = p.curve, W = 150, H = 38, max = 0;
    pts.forEach(function (x) { if (x.delivered >= 40 && x.rate && x.rate.rate > max) max = x.rate.rate; });
    if (!max) return null;
    var bars = pts.map(function (x, i) {
      var ok = x.delivered >= 40 && x.rate, hh = ok ? Math.max(2, Math.round((x.rate.rate / max) * (H - 4))) : 0;
      return h`<rect key=${i} x=${i * 25 + 3} y=${H - hh} width="19" height=${hh} className=${ok ? 'ct-bar' : 'ct-bar is-none'}><title>${i === 0 ? 'First time seen' : 'Seen ' + (i + 1) + ' times'}: ${ok ? rate(x.rate.rate) : 'not enough data'}</title></rect>`;
    });
    return h`<svg className="ct-curve" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label=${'Rate by how many times the same person has seen this block: ' + pts.map(function (x, i) { return (i + 1) + ': ' + (x.delivered >= 40 && x.rate ? rate(x.rate.rate) : 'no data'); }).join(', ')}>${bars}</svg>`;
  }

  function TopTired(p) {
    var w = p.w, KK = K(), perf = perfRows(w);
    var rows = Object.keys(perf).map(function (id) { return perf[id]; }).filter(function (r) { return r.enough && r.lift && KK.block(w, r.key); });
    var top = rows.slice().sort(function (a, b) { return b.lift.value - a.lift.value; }).slice(0, 5);
    var tired = KK.blocks(w).filter(function (b) { return !b.retired && !b.archived; }).map(function (b) { return { b: b, f: sel('blockFatigue', w, b.id) }; })
      .filter(function (x) { return x.f && x.f.tired && x.f.drop; });
    tired.sort(function (a, b) { return a.f.drop.value - b.f.drop.value; });
    tired = tired.slice(0, 5);
    return h`<div className="ct-two">
      <section aria-label="Top blocks"><h2 className="ct-h">Blocks doing best</h2>
        ${!selReady('contentPerformance') ? h`<${Placeholder}>Appears once results are in.<//>` : (!top.length ? h`<${Placeholder}>Not enough data yet to rank blocks.<//>` :
          h`<ol className="ct-rank">${top.map(function (r) { var b = KK.block(w, r.key), pl = perfLine(r);
            return h`<li key=${r.key}><span className="ct-rank-t">${clip(tokenText(KK.textOf(b)), 70)}<span className="ct-meta">${kindLabel(b.kind)} ${DOT} ${tagWords(b.tags).join(' ' + DOT + ' ')}</span></span><span className="ct-rank-v">${pl.text}</span></li>`; })}</ol>`)}
      </section>
      <section aria-label="Tired blocks"><h2 className="ct-h">Blocks wearing out</h2>
        <p className="ct-meta">Response each time the same person sees the block again.</p>
        ${!selReady('blockFatigue') ? h`<${Placeholder}>Appears once results are in.<//>` : !tired.length ? h`<${Placeholder}>No block has clearly worn out yet.<//>` :
          h`<ol className="ct-rank">${tired.map(function (x) {
            var d = x.f.drop;
            return h`<li key=${x.b.id}><span className="ct-rank-t">${clip(tokenText(KK.textOf(x.b)), 70)}<span className="ct-meta">Used in ${plural(KK.usedCount(w, x.b.id), 'place')} ${DOT} ${x.f.metric === 'open' ? 'Opens' : 'Clicks'} fall ${Math.abs(Math.round(d.value * 100))}% (${Math.abs(Math.round(d.hi * 100))}% to ${Math.abs(Math.round(d.lo * 100))}%) when seen again</span></span><${Curve} curve=${x.f.curve} /></li>`; })}</ol>`}
      </section>
    </div>`;
  }

  function Recs(p) {
    var w = p.w, list = sel('contentRecommendations', w);
    var ps = useSel(function (x) { return x.proposals; });
    function pendingFor(r) {
      if (!ps || !ps.order || !r.blockIds) return null;
      for (var i = 0; i < ps.order.length; i++) {
        var x = ps.byId[ps.order[i]];
        if (x && x.status === 'pending' && (x.actions || EMPTY).some(function (a) { return a.type === 'block/retire' && r.blockIds.indexOf((a.payload || {}).id) >= 0; })) return x;
      }
      return null;
    }
    return h`<section className="ct-int" aria-label="What your agents recommend">
      <h2 className="ct-h">What your agents recommend</h2>
      ${!selReady('contentRecommendations') ? h`<${Placeholder}>Recommendations appear here once the agents have results to learn from.<//>`
        : !Array.isArray(list) || !list.length ? h`<${Placeholder}>Nothing to recommend right now.<//>`
        : h`<ul className="ct-recs">${list.map(function (r) {
          var px = pendingFor(r);
          return h`<li key=${r.id}>
            <p><b>${tokenText(r.title)}</b> <span className="ct-muted">${tokenText(r.summary)}</span>${(r.evidence || EMPTY).length ? h`<br /><span className="ct-meta">${r.evidence.map(function (e) { return e.label + ': ' + e.value; }).join('  ' + DOT + '  ')}</span>` : null}</p>
            ${px ? h`<${Btn} kind="secondary" size="sm" onClick=${function () { dispatch('proposal/approve', { id: px.id }); }}>Approve<//>` : null}</li>`;
        })}</ul>`}
    </section>`;
  }

  function Intelligence() {
    var React = R();
    var st = React.useState(memo.dim), dim = st[0], setDim0 = st[1];
    var c = useSel(function (w) { return w.content; });
    var w = world();
    function setDim(d) { memo.dim = d; setDim0(d); }
    if (!w || !c) return h`<p className="ct-empty">Loading${ELL}</p>`;
    return h`<div className="ct-intel"><${Matrix} dim=${dim} onDim=${setDim} /><${TopTired} w=${w} /><${Recs} w=${w} /></div>`;
  }

  /* ================= View ================= */
  var TABS = [['library', 'Library'], ['compose', 'Compose'], ['intelligence', 'Intelligence']];

  function ContentView() {
    var React = R();
    var focus = MC.hooks.useUi(function (s) { return s.focus && s.focus.content; }) || {};
    var ready = useSel(function (w) { return !!(w && w.content && w.content.messages); });
    var ts = React.useState(memo.tab), tab = ts[0], setTab0 = ts[1];
    var ms = React.useState(memo.msgId), msgId0 = ms[0], setMsg0 = ms[1];
    var wide = MC.hooks.useMedia ? MC.hooks.useMedia('(min-width: 720px)') : true;
    var fkey = [focus.messageId, focus.variantId, focus.tab, focus.blockId, focus.n].join('|');
    var kk = React.useState(0), kick = kk[0], setKick = kk[1];
    var seen = React.useRef('');
    // Links from the rest of the app arrive as focus: a message, or a channel version (variant).
    React.useEffect(function () {
      if (!ready || seen.current === fkey || (!focus.messageId && !focus.variantId && !focus.tab && !focus.blockId)) return;
      seen.current = fkey;
      var w = world(), id = focus.messageId;
      if (!id && focus.variantId && w && w.variants.byId[focus.variantId]) id = w.variants.byId[focus.variantId].messageId || null;
      if (focus.blockId) { memo.q = ''; memo.show = 'all'; memo.kind = ''; memo.angle = ''; memo.tone = ''; memo.review = ''; memo.channel = ''; memo.tab = 'library'; setTab0('library'); setKick(function (k) { return k + 1; }); }
      else if (id) { memo.msgId = id; setMsg0(id); memo.tab = 'compose'; setTab0('compose'); }
      else if (focus.tab && TABS.some(function (t) { return t[0] === focus.tab; })) { memo.tab = focus.tab; setTab0(focus.tab); }
    }, [fkey, ready]);
    function setTab(t) { memo.tab = t; setTab0(t); }
    function openMessage(id) { memo.msgId = id; setMsg0(id); setTab('compose'); setFocus({ messageId: id, variantId: null }); }

    var firstMsg = useSel(function (w) { return w.content && w.content.messages.order[0] || null; });
    var msgId = msgId0 || firstMsg;
    var msgs = useSel(function (w) { return w.content ? w.content.messages : null; });
    var review = useSel(function (w) { return w.content && w.content.messages ? w.content.messages.order.filter(function (id) { var m = w.content.messages.byId[id]; return m && m.review === 'in_review'; }).length : 0; });
    var nMsgs = msgs ? msgs.order.length : 0;
    var sentence = !ready ? 'Loading content' + ELL : !nMsgs ? 'No messages yet. Write one in Compose, or ask for one from Goals.'
      : plural(nMsgs, 'message', 'messages') + ' you can reuse across channels' + (review ? '; ' + review + ' waiting for review.' : '; none waiting for review.');
    function onKey(e, i) {
      var j = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : -1;
      if (j < 0) return;
      e.preventDefault(); setTab(TABS[j][0]);
      var el = document.getElementById('ct-tab-' + TABS[j][0]); if (el) el.focus();
    }
    return h`<section className="v-content">
      <header className="ct-header">
        <div><h1 id="page-title" tabIndex="-1" className="ct-title">Content</h1>
        <p className="ct-sub" id="ct-sentence">${sentence}</p></div>
        <div className="ct-tabs" role="tablist" aria-label="Content sections">${TABS.map(function (t, i) {
          return h`<button key=${t[0]} id=${'ct-tab-' + t[0]} type="button" role="tab" aria-selected=${tab === t[0] ? 'true' : 'false'} aria-controls="ct-panel" tabIndex=${tab === t[0] ? 0 : -1}
            className=${cx('ct-tab', tab === t[0] && 'is-on')} onKeyDown=${function (e) { onKey(e, i); }} onClick=${function () { setTab(t[0]); }}>${t[1]}</button>`;
        })}</div>
      </header>
      <div id="ct-panel" role="tabpanel" aria-labelledby=${'ct-tab-' + tab}>
        ${!ready ? h`<p className="ct-empty">Loading content${ELL}</p>`
          : tab === 'library' ? h`<${Library} onOpenMessage=${openMessage} openBlock=${focus.blockId || null} openKey=${fkey + '|' + kick} />`
          : tab === 'compose' ? h`<div>
              <label className="ct-filter ct-pick"><span>Message</span>
                <select id="ct-msg" className="ct-select" value=${msgId || ''} onChange=${function (e) { openMessage(e.target.value); }}>${(msgs ? msgs.order : EMPTY).map(function (id) { return h`<option key=${id} value=${id}>${msgs.byId[id].name}</option>`; })}</select></label>
              <${Compose} msgId=${msgId} /></div>`
          : h`<${Intelligence} />`}
      </div>
    </section>`;
  }

  MC.views.content = ContentView;
  MC.content.drafts = function () {
    var w = world(), KK = K();
    return Object.keys(drafts).filter(function (id) {
      return Object.keys(drafts[id] || {}).some(function (k) { var d = drafts[id][k], b = w && KK.block(w, d.baseId); return b && d.text !== textOfValue(b.kind, b.value); });
    });
  };
})();
