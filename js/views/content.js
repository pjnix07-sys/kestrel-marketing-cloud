/* Marketing Cloud · Content Studio (#content). MC.views.content.
   Library · Composer (+ Generate variants) · Preview & checks. The composer draft lives in component
   state (mirrored in module memory so it survives switching variants and routes) and is never replaced
   from the store while dirty; a ver change underneath shows a ConflictChip. Generation is pure
   (MC.copy.generate) behind a Promise so an optional async writer can slot in later. Only explicit
   clicks dispatch: variant/update and variant/create. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};
  MC.content = MC.content || {};

  var EMPTY = [];
  var DOT = '·', DASH = '—', ELL = '…', MINUS = '−';

  function R() { return window.React; }
  function h() { return MC.html.apply(null, arguments); }

  /* Quiet "Made by <mission goal> · <agent>" back-link for objects a mission produced (mission.artifacts). */
  function MadeBy(p) {
    var ms = MC.hooks && MC.hooks.useSelect ? MC.hooks.useSelect(function (w) { return w ? w.missions || null : null; }) : null;
    if (!ms || !ms.order || !p.id) return null;
    var hit = null, ag = null;
    ms.order.forEach(function (mid) {
      var m = ms.byId[mid];
      if (!m || hit) return;
      (m.artifacts || []).forEach(function (a) { if (a.kind === p.kind && a.id === p.id) hit = m; });
    });
    if (!hit) return null;
    (hit.plan || []).forEach(function (s) { if (s.artifact && s.artifact.kind === p.kind && s.artifact.id === p.id) ag = s.agentId; });
    var nm = ag && MC.lead && MC.lead.agentName ? MC.lead.agentName(ag) : null;
    return h`<p className="mc-madeby">Made by <a href=${'#missions/' + encodeURIComponent(hit.id)}>${hit.title || hit.goalText}</a>${nm ? ' \u00b7 ' + nm : ''}</p>`;
  }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function has(o, n) { return !!o && typeof o[n] === 'function'; }
  function str(x) { return typeof x === 'string' ? x : (x == null ? '' : String(x)); }
  function cx() { var o = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }
  function CP() { return MC.copy || {}; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /* ---------------- formatting ---------------- */
  function fmtNum(n) { return fin(n) ? (MC.fmt && MC.fmt.num ? MC.fmt.num(n) : String(Math.round(n))) : DASH; }
  function fmtPct(p, dp) { return fin(p) ? (MC.fmt && MC.fmt.pct ? MC.fmt.pct(p, dp == null ? 1 : dp) : (p * 100).toFixed(dp == null ? 1 : dp) + '%') : DASH; }
  function fmtShare(p) { return fin(p) ? Math.round(p * 100) + '%' : DASH; }
  function relTime(t, now) {
    if (!fin(t) || !fin(now)) return '';
    try { if (MC.time && has(MC.time, 'relLabel')) return MC.time.relLabel(t, now); } catch (e) { /* fall back */ }
    try { if (MC.fmt && has(MC.fmt, 'rel')) return MC.fmt.rel(t, now); } catch (e2) { /* fall back */ }
    return '';
  }
  function chLabel(ch) { return (MC.CH && MC.CH.LABEL && MC.CH.LABEL[ch]) || ch; }
  function agentName(id) {
    if (MC.ui && has(MC.ui, 'agentName')) return MC.ui.agentName(id);
    return str(id).replace(/^agent:/, '');
  }
  function agentOf(by) { return typeof by === 'string' && by.indexOf('agent:') === 0 ? by.slice(6) : null; }

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
  function setFocus(patch) {
    try {
      if (MC.uiStore && has(MC.uiStore, 'setFocus')) MC.uiStore.setFocus('content', patch);
    } catch (e) { /* convenience only */ }
  }
  function go(route, patch) { try { MC.nav.go(route, patch); } catch (e) { window.location.hash = '#' + route; } }
  function sel(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (!MC.select || !has(MC.select, name)) return null;
    try { return MC.select[name].apply(null, args); } catch (e) { return null; }
  }
  function useMedia(q) {
    var f = MC.hooks && MC.hooks.useMedia;
    if (typeof f === 'function') return f(q);
    return !!(window.matchMedia && window.matchMedia(q).matches);
  }

  /* ---------------- kit with tiny fallbacks ---------------- */
  function FbButton(p) {
    return h`<button type="button" id=${p.id} className=${'cs-fbbtn cs-fbbtn-' + (p.kind || 'secondary')} onClick=${p.onClick}
      disabled=${!!p.disabled || !!p.busy}>${p.children}</button>`;
  }
  function Btn(p) { var B = (MC.ui && MC.ui.Button) || FbButton; return h`<${B} ...${p}>${p.children}<//>`; }
  function Icon(p) { var I = MC.ui && MC.ui.Icon; return I ? h`<${I} name=${p.name} size=${p.size || 16} />` : null; }
  function Ring(p) {
    var S = MC.charts && MC.charts.ScoreRing;
    if (S) return h`<${S} value=${p.value} size=${p.size || 40} label="Predicted engagement" />`;
    return h`<span className="cs-ring-fb num">${fin(p.value) ? Math.round(p.value) : DASH}</span>`;
  }
  function Scene(p) {
    var S = MC.ui && MC.ui.Scene;
    if (!p.imageId) return null;
    return S ? h`<${S} imageId=${p.imageId} title=${p.title} />` : h`<div className="cs-scene-fb" role="img" aria-label=${p.title || 'Illustration'}></div>`;
  }
  function Msg(p) {
    if (!p.msg) return null;
    return h`<p className=${'cs-msg cs-msg-' + (p.msg.tone || 'neutral')} role=${p.msg.tone === 'crit' ? 'alert' : null}>${p.msg.text}${p.children}</p>`;
  }

  /* ---------------- channel model ---------------- */
  var FIELDS_FB = {
    email: ['subject', 'preheader', 'headline', 'body', 'cta', 'link', 'imageId', 'alt'],
    sms: ['sms', 'link'], push: ['pushTitle', 'pushBody', 'link'],
    social: ['socialText', 'socialHeadline', 'cta', 'link', 'imageId', 'alt'],
    web: ['socialText', 'socialHeadline', 'cta', 'link', 'imageId', 'alt']
  };
  var LABEL_FB = { subject: 'Subject', preheader: 'Preheader', headline: 'Headline', body: 'Body', cta: 'Button label', link: 'Link',
    imageId: 'Image', alt: 'Alt text', sms: 'Message', pushTitle: 'Title', pushBody: 'Body', socialText: 'Primary text', socialHeadline: 'Headline' };
  var FIELD_ID = { subject: 'cs-subject', preheader: 'cs-preheader', headline: 'cs-headline', body: 'cs-body', cta: 'cs-cta', link: 'cs-link',
    alt: 'cs-alt', sms: 'cs-sms', pushTitle: 'cs-push-title', pushBody: 'cs-push-body', socialText: 'cs-social-text', socialHeadline: 'cs-social-headline' };
  var MULTI = { body: 5, sms: 4, pushBody: 3, socialText: 3 };
  var COMPOSE_CHANNELS = ['email', 'sms', 'push', 'social'];
  var TOKENS_FB = ['{first_name}', '{product}', '{offer}', '{link}'];

  function fieldsFor(ch) { var F = CP().FIELDS || FIELDS_FB; return F[ch] || F.email; }
  function fieldLabel(k) { return (CP().FIELD_LABEL || LABEL_FB)[k] || k; }
  function limitFor(k, brand) {
    if (k === 'subject' && brand && fin(brand.maxSubject)) return brand.maxSubject;
    var L = CP().LIMITS || {};
    return L[k] || 0;
  }
  function hookOf(ch) { return (CP().HOOK || { email: 'subject', sms: 'sms', push: 'pushTitle', social: 'socialHeadline', web: 'socialHeadline' })[ch]; }
  function blankFields(ch) {
    var f = {};
    fieldsFor(ch).forEach(function (k) { f[k] = ''; });
    if (f.link !== undefined) f.link = 'fernway.co/shop';
    return f;
  }
  function normFields(ch, src) {
    var f = blankFields(ch);
    Object.keys(f).forEach(function (k) { if (src && src[k] != null) f[k] = str(src[k]); });
    return f;
  }
  function sameFields(a, b) {
    var ks = {}, k;
    for (k in a || {}) ks[k] = 1;
    for (k in b || {}) ks[k] = 1;
    for (k in ks) if (str((a || {})[k]) !== str((b || {})[k])) return false;
    return true;
  }
  function measure(text, vlike) {
    try { if (has(CP(), 'measure')) return CP().measure(text, vlike); } catch (e) { /* fall back */ }
    return str(text).length;
  }
  function productName(id) {
    var list = (MC.data && MC.data.PRODUCTS) || EMPTY;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return null;
  }

  var CH_WORD = { email: 'email', sms: 'SMS', push: 'push', social: 'social', web: 'web' };
  function chWord(ch) { return CH_WORD[ch] || str(ch); }
  // Last day an offer runs, from a campaign (null when the campaign has no offer).
  function dayEnd(c) { return c && c.offer && c.offer !== 'none' && fin(c.end) ? Math.floor((c.end - 1) / 24) : null; }
  function dayName(day) { try { return MC.time.dayLabel(day); } catch (e) { return ''; } }
  function dayYmd(day) { try { return MC.time.ymd(day); } catch (e) { return ''; } }
  function ymdDay(s) { try { var x = MC.time.dayOfYmd(s); return fin(x) ? x : null; } catch (e) { return null; } }

  /* ---------------- approved claims live in the guardrails (logged, so every change has a who and a when) ---------------- */
  function claimsNow() {
    var w = world();
    return (w && w.guardrails && w.guardrails.claims) || (CP().DEFAULT_BRAND && CP().DEFAULT_BRAND.claims) || EMPTY;
  }
  function setClaims(list) { return dispatch('guardrails/update', { patch: { claims: list } }); }
  function useBrandRev() { return useSel(function (w) { return w.guardrails ? w.guardrails.claims : null; }); }
  function effectiveBrand(b) { return Object.assign({}, CP().DEFAULT_BRAND || {}, b || {}, { claims: claimsNow() }); }

  /* ---------------- review states and the person viewing ---------------- */
  var REVIEW_WORD = { draft: 'Draft', in_review: 'In review', changes: 'Changes requested', approved: 'Approved' };
  var REVIEW_TONE = { draft: 'neutral', in_review: 'accent', changes: 'warn', approved: 'good' };
  function reviewOf(v) { return (v && v.review) || 'approved'; }
  // One pill per variant: its review state until the copy is approved, then where it stands.
  function stateOf(v) {
    var r = reviewOf(v);
    if (v.status === 'retired') return { label: 'Retired', tone: 'neutral' };
    if (r !== 'approved') return { label: REVIEW_WORD[r], tone: REVIEW_TONE[r] };
    var word = STATUS_WORD[v.status] || str(v.status);
    return { label: word, tone: v.status === 'live' ? 'good' : v.status === 'paused' ? 'warn' : 'neutral' };
  }
  function usePersona() { return MC.hooks.useUi(function (s) { return s.persona || 'admin'; }) || 'admin'; }
  function personaName(id) { try { return MC.catalog.personaName(id); } catch (e) { return str(id); } }
  function can(who, perm) { try { return MC.catalog.can(who, perm); } catch (e) { return true; } }
  function whoLabel(by) {
    if (!by || by === 'user') return 'A teammate';
    var ag = agentOf(by);
    return ag ? agentName(ag) : personaName(by);
  }
  // Word-level diff (longest common subsequence) between two strings.
  function wordDiff(a, b) {
    var x = str(a).split(/(\s+)/).filter(Boolean), y = str(b).split(/(\s+)/).filter(Boolean);
    var n = x.length, m = y.length, L = [], i, j;
    for (i = 0; i <= n; i++) { L.push([]); for (j = 0; j <= m; j++) L[i].push(0); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = [], push = function (t, w) { if (out.length && out[out.length - 1].t === t) out[out.length - 1].s += w; else out.push({ t: t, s: w }); };
    i = 0; j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { push('del', x[i]); i++; }
      else { push('add', y[j]); j++; }
    }
    while (i < n) { push('del', x[i++]); }
    while (j < m) { push('add', y[j++]); }
    return out;
  }
  MC.content.wordDiff = wordDiff;

  /* ---------------- module memory (never written to the world) ---------------- */
  var drafts = {};             // key -> {fields, baseFields, baseVer, tone, offer, productId, channel}
  var genMemo = { results: [], opts: null, n: 0, selected: {} };
  var viewMemo = { newRev: 0, reviewed: {}, tab: 'studio' };
  function draftKey(vid, ch) { return vid ? 'v:' + vid : 'new:' + (ch || 'email'); }
  function isDirtyKey(key) { var d = drafts[key]; return !!d && !sameFields(d.fields, d.baseFields); }

  // Generation goes through a Promise so an async writer (if one is ever registered) can take over;
  // anything missing, empty or failing falls back to the deterministic phrase-bank generator.
  function runGenerate(opts) {
    var cp = CP();
    function local() { return has(cp, 'generate') ? cp.generate(opts) : []; }
    var live = cp.generateLive || cp.generateAsync;
    var p;
    try { p = typeof live === 'function' ? Promise.resolve(live(opts)) : Promise.resolve(local()); } catch (e) { p = Promise.reject(e); }
    return p.then(function (r) {
      if (!Array.isArray(r) || !r.length) return local();
      return r.map(function (d, k) {
        var v = Object.assign({ tmpId: '$v' + k, name: String.fromCharCode(65 + k), channel: opts.channel, tone: opts.tone, offer: opts.offer, productId: opts.productId }, d);
        if (!v.predicted && has(cp, 'score')) { var s = cp.score(v); v.predicted = { score: s.score, open: s.predOpen, click: s.predClick }; }
        return v;
      });
    }).catch(function () { return local(); });
  }

  /* ================= Library ================= */
  var FILTERS = [{ value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'live', label: 'Live' }, { value: 'agent', label: 'By agents' }];
  var STATUS_WORD = { draft: 'Draft', live: 'Live', paused: 'Paused', retired: 'Retired', scheduled: 'Scheduled', completed: 'Completed' };

  function CopyDrafterNote() {
    var React = R();
    var list = useSel(function (w) {
      var pr = w.proposals; if (!pr) return EMPTY;
      return (pr.open || EMPTY).map(function (id) { return pr.byId[id]; })
        .filter(function (x) { return x && x.status === 'pending' && x.agentId === 'copy'; });
    }, MC.util && MC.util.arrayEqual) || EMPTY;
    var st = React.useState(false), open = st[0], setOpen = st[1];
    if (!list.length) return null;
    var PC = MC.ui && MC.ui.ProposalCard;
    return h`<div className="cs-agentnote">
      <button type="button" className="cs-agentnote-btn" aria-expanded=${open ? 'true' : 'false'} onClick=${function () { setOpen(!open); }}>
        <span className="cs-adot" aria-hidden="true"></span>
        <span>Copy Drafter suggested ${list.length === 1 ? 'a new challenger' : list.length + ' new challengers'}</span>
        <span className="cs-agentnote-act">${open ? 'Hide' : 'Review'}</span>
      </button>
      ${open && PC ? h`<div className="cs-agentnote-list">${list.map(function (p) { return h`<${PC} key=${p.id} id=${p.id} flat=${true} compact=${true} showTarget=${true} />`; })}</div>` : null}
    </div>`;
  }

  function Library(p) {
    var React = R();
    var lib = useSel(function (w) { return sel('variantLibrary', w); }) || EMPTY;
    var variants = useSel(function (w) { return w.variants; });
    var qs = React.useState(''), q = qs[0], setQ = qs[1];
    var fs = React.useState('all'), filter = fs[0], setFilter = fs[1];
    var cs = React.useState(false), showDone = cs[0], setShowDone = cs[1];
    var Seg = MC.ui && MC.ui.Segmented;
    var needle = q.trim().toLowerCase();
    var who = usePersona();
    var canReview = can(who, 'copy');

    function hookText(v) {
      var full = variants && variants.byId[v.id];
      return full ? str(full.fields && full.fields[hookOf(full.channel)]) : '';
    }
    var needsMine = !canReview || !variants ? 0 : Object.keys(variants.byId).filter(function (k) { return reviewOf(variants.byId[k]) === 'in_review' && variants.byId[k].status !== 'retired'; }).length;
    var groups = lib.map(function (g) {
      var vs = g.variants.filter(function (v) {
        if (v.status === 'retired' && v.id !== p.selectedId) return false;
        if (filter === 'draft' && v.status !== 'draft') return false;
        if (filter === 'live' && v.status !== 'live') return false;
        if (filter === 'agent' && !agentOf(v.author)) return false;
        if (filter === 'mine' && !(canReview && variants && variants.byId[v.id] && reviewOf(variants.byId[v.id]) === 'in_review')) return false;
        if (needle) {
          var hay = (g.name + ' ' + v.name + ' ' + chLabel(v.channel) + ' ' + hookText(v)).toLowerCase();
          if (hay.indexOf(needle) < 0) return false;
        }
        return true;
      });
      return { g: g, vs: vs };
    }).filter(function (x) { return x.vs.length; });
    var active = groups.filter(function (x) { return x.g.status !== 'completed'; });
    var done = groups.filter(function (x) { return x.g.status === 'completed'; });
    var total = lib.reduce(function (n, g) { return n + g.variants.length; }, 0);

    function row(v) {
      var on = v.id === p.selectedId;
      var ag = agentOf(v.author);
      var hook = hookText(v);
      var dirty = isDirtyKey(draftKey(v.id));
      var full = variants && variants.byId[v.id];
      var st = stateOf(full ? Object.assign({}, v, { review: full.review }) : v);
      return h`<li key=${v.id}>
        <button type="button" id=${'cs-lib-' + v.id} className=${cx('cs-lib-row', on && 'is-on')} aria-current=${on ? 'true' : null}
          onClick=${function () { p.onSelect(v.id, v.channel); }}>
          <span className="cs-lib-name">
            <span className=${'cs-sdot is-' + (st.tone === 'good' ? 'live' : st.tone === 'warn' ? 'paused' : st.tone === 'accent' ? 'review' : 'draft')} aria-hidden="true"></span>
            <span className="cs-lib-title">${chLabel(v.channel)} ${v.name}</span>
            ${ag ? h`<span className="cs-adot" title=${'Drafted by ' + agentName(ag)}><span className="sr-only">${' drafted by ' + agentName(ag)}</span></span>` : null}
            <span className="cs-lib-meta num">${st.label}${v.status === 'live' && st.label === 'Live' ? ' ' + DOT + ' ' + fmtShare(v.share) : ''}${dirty ? ' ' + DOT + ' unsaved' : ''}</span>
          </span>
          <span className="cs-lib-hook">${hook || h`<span className="cs-muted">No ${fieldLabel(hookOf(v.channel)).toLowerCase()} yet</span>`}</span>
        </button>
      </li>`;
    }
    function group(x) {
      return h`<li key=${x.g.campaignId} className="cs-lib-group">
        <p className="cs-lib-camp"><span>${x.g.name}</span> <span className="cs-muted">${STATUS_WORD[x.g.status] || x.g.status}</span></p>
        <ul className="cs-lib-list">${x.vs.map(row)}</ul>
      </li>`;
    }

    return h`<nav className="cs-lib" aria-label="Content library">
      <div className="cs-lib-head">
        <h2 className="cs-h2">Library <span className="cs-count num">${total}</span></h2>
        <button type="button" id="cs-new" className="cs-link" onClick=${p.onNew}>New draft</button>
      </div>
      <label className="sr-only" htmlFor="cs-search">Search content</label>
      <input id="cs-search" className="k-input cs-search" type="search" placeholder="Search campaigns or copy" value=${q}
        onChange=${function (e) { setQ(e.target.value); }} />
      ${Seg ? h`<${Seg} id="cs-filter" label="Filter variants" size="sm" options=${FILTERS} value=${filter} onChange=${setFilter} block=${true} />`
        : h`<select id="cs-filter" className="k-select" value=${filter} onChange=${function (e) { setFilter(e.target.value); }}>
            ${FILTERS.map(function (f) { return h`<option key=${f.value} value=${f.value}>${f.label}</option>`; })}</select>`}
      <button type="button" id="cs-filter-mine" className=${cx('cs-mine', filter === 'mine' && 'is-on')} aria-pressed=${filter === 'mine' ? 'true' : 'false'}
        onClick=${function () { setFilter(filter === 'mine' ? 'all' : 'mine'); }}>Needs my review${needsMine ? ' (' + needsMine + ')' : ''}</button>
      <${CopyDrafterNote} />
      ${!lib.length ? h`<p className="cs-empty">No content yet. Start from a campaign or generate variants from a tone and product.</p>`
        : !groups.length ? h`<p className="cs-empty">${filter === 'mine' ? (canReview ? 'Nothing is waiting for your review.' : 'Your role can’t approve copy.') : 'Nothing matches. Try another search or filter.'}</p>`
        : h`<ul className="cs-lib-groups">
            ${active.map(group)}
            ${done.length ? (showDone ? done.map(group) : null) : null}
          </ul>`}
      ${done.length ? h`<button type="button" className="cs-link cs-lib-more" aria-expanded=${showDone ? 'true' : 'false'}
          onClick=${function () { setShowDone(!showDone); }}>${showDone ? 'Hide completed campaigns' : 'Show completed campaigns (' + done.length + ')'}</button>` : null}
    </nav>`;
  }

  /* ================= Draft state ================= */
  function initDraft(key, variant, ch, seed) {
    if (drafts[key]) {
      var d = drafts[key];
      if (variant && !isDirtyKey(key) && d.baseVer !== variant.ver) delete drafts[key];
      else return d;
    }
    if (variant) {
      var f = normFields(variant.channel, variant.fields);
      drafts[key] = { channel: variant.channel, fields: f, baseFields: clone(f), baseVer: variant.ver,
        tone: variant.tone, offer: variant.offer, productId: variant.productId };
    } else {
      var base = blankFields(ch);
      drafts[key] = Object.assign({ channel: ch, fields: clone(base), baseFields: base, baseVer: null, tone: 'practical', offer: 'none', productId: null }, seed || {});
    }
    return drafts[key];
  }

  function useStudioDraft(key, variant, ch) {
    var React = R();
    var st = React.useState(function () { return initDraft(key, variant, ch); });
    var d = st[0], setD = st[1];
    function update(patch) {
      setD(function (cur) {
        var next = Object.assign({}, cur, typeof patch === 'function' ? patch(cur) : patch);
        drafts[key] = next;
        return next;
      });
    }
    var dirty = !sameFields(d.fields, d.baseFields);
    var conflict = false;
    if (variant && d.baseVer !== variant.ver) {
      if (dirty && !sameFields(variant.fields ? normFields(variant.channel, variant.fields) : {}, d.baseFields)) conflict = true;
    }
    // Adopt store changes only while clean; a dirty draft is never replaced (conflict chip instead).
    React.useEffect(function () {
      if (!variant || d.baseVer === variant.ver) return;
      var theirs = normFields(variant.channel, variant.fields);
      if (!dirty) update({ fields: clone(theirs), baseFields: theirs, baseVer: variant.ver });
      else if (sameFields(theirs, d.baseFields)) update({ baseVer: variant.ver });
    });
    return {
      d: d, dirty: dirty, conflict: conflict, update: update,
      setField: function (k, v) { update(function (cur) { var f = Object.assign({}, cur.fields); f[k] = v; return { fields: f }; }); },
      takeTheirs: function () { var t = normFields(variant.channel, variant.fields); update({ fields: clone(t), baseFields: t, baseVer: variant.ver }); },
      keepMine: function () { update({ baseFields: normFields(variant.channel, variant.fields), baseVer: variant.ver }); },
      revert: function () { update(function (cur) { return { fields: clone(cur.baseFields) }; }); },
      markSaved: function (ver) { update(function (cur) { return { baseFields: clone(cur.fields), baseVer: fin(ver) ? ver : cur.baseVer }; }); }
    };
  }

  /* ================= Composer ================= */
  function FieldRow(p) {
    var k = p.k, id = FIELD_ID[k] || 'cs-' + k;
    var lim = p.limit, len = measure(p.value, p.vlike);
    var over = lim > 0 && len > lim;
    var common = {
      id: id, className: cx('k-input', MULTI[k] && 'k-textarea', 'cs-input', over && 'is-over'), value: p.value, disabled: p.readOnly,
      'aria-describedby': lim ? id + '-count' : null,
      onChange: function (e) { p.onChange(k, e.target.value); },
      onFocus: function (e) { p.onFocusField(k, e.target); },
      onSelect: function (e) { p.onFocusField(k, e.target); }
    };
    return h`<div className="cs-field">
      <div className="cs-field-head">
        <label className="cs-label" htmlFor=${id}>${fieldLabel(k)}</label>
        ${lim ? h`<span id=${id + '-count'} className=${cx('cs-counter num', over && 'is-over')}>${len}/${lim}</span>` : null}
      </div>
      ${MULTI[k] ? h`<textarea ...${common} rows=${MULTI[k]}></textarea>` : h`<input ...${common} type="text" />`}
    </div>`;
  }

  function ImagePicker(p) {
    var imgs = CP().IMAGES || EMPTY;
    return h`<fieldset className="cs-field cs-images">
      <legend className="cs-label">Image</legend>
      <div className="cs-image-grid" role="radiogroup" aria-label="Image">
        ${imgs.map(function (im) {
          var on = p.value === im.id;
          return h`<button key=${im.id} type="button" role="radio" aria-checked=${on ? 'true' : 'false'} id=${'cs-img-' + im.id}
            className=${cx('cs-image', on && 'is-on')} disabled=${p.readOnly} title=${im.label} onClick=${function () { p.onPick(im); }}>
            <${Scene} imageId=${im.id} title=${im.label} />
            <span className="cs-image-label">${im.label}</span>
          </button>`;
        })}
      </div>
    </fieldset>`;
  }

  function ChannelPicker(p) {
    var Seg = MC.ui && MC.ui.Segmented;
    var opts = COMPOSE_CHANNELS.map(function (c) { return { value: c, label: chLabel(c) === 'Social ads' ? 'Social' : chLabel(c) }; });
    if (Seg) return h`<${Seg} id="cs-channel" label="Channel" size="sm" options=${opts} value=${p.value} onChange=${p.onChange} />`;
    return h`<select id="cs-channel" className="k-select" value=${p.value} onChange=${function (e) { p.onChange(e.target.value); }}>
      ${opts.map(function (o) { return h`<option key=${o.value} value=${o.value}>${o.label}</option>`; })}</select>`;
  }

  function campaignOptions(campaigns, ch) {
    if (!campaigns) return EMPTY;
    return campaigns.order.map(function (id) { return campaigns.byId[id]; })
      .filter(function (c) { return c && c.status !== 'completed' && c.channels.indexOf(ch === 'web' ? 'web' : ch) >= 0; });
  }
  var SHARES = [0.1, 0.2, 0.25, 0.33, 0.5];

  function AddControls(p) {
    var opts = p.options;
    if (!opts.length) return h`<p className="cs-note">No active campaign uses ${chLabel(p.channel)}. Plan one in Campaigns first.</p>`;
    return h`<div className="cs-add">
      <label className="cs-inline-label" htmlFor=${p.idPrefix + '-campaign'}>Campaign</label>
      <select id=${p.idPrefix + '-campaign'} className="k-select cs-add-camp" value=${p.cid} onChange=${function (e) { p.setCid(e.target.value); }}>
        ${opts.map(function (c) { return h`<option key=${c.id} value=${c.id}>${c.name} (${STATUS_WORD[c.status] || c.status})</option>`; })}
      </select>
      <label className="cs-inline-label" htmlFor=${p.idPrefix + '-share'}>Traffic</label>
      <select id=${p.idPrefix + '-share'} className="k-select cs-add-share" value=${String(p.share)} onChange=${function (e) { p.setShare(Number(e.target.value)); }}>
        ${SHARES.map(function (s) { return h`<option key=${s} value=${String(s)}>${Math.round(s * 100)}%</option>`; })}
      </select>
    </div>`;
  }

  function AgentLine(p) {
    var React = R();
    var v = p.variant;
    var ag = agentOf(v.author);
    var now = useSel(function (w) { return w.meta.tick; });
    var prop = useSel(function (w) {
      var pr = w.proposals; if (!pr || !ag) return null;
      for (var i = 0; i < pr.order.length; i++) {
        var x = pr.byId[pr.order[i]];
        if (x && x.created && x.created.indexOf(v.id) >= 0) return x.id;
      }
      return null;
    });
    var st = React.useState(false), open = st[0], setOpen = st[1];
    if (!ag) return null;
    var PC = MC.ui && MC.ui.ProposalCard;
    var when = relTime(v.createdTick, now);
    return h`<div className="cs-agentline">
      <p className="cs-agentline-text"><span className="cs-adot" aria-hidden="true"></span>
        Drafted by ${agentName(ag)}${when ? ', ' + when : ''}
        ${prop && PC ? h` <button type="button" className="cs-link" aria-expanded=${open ? 'true' : 'false'} onClick=${function () { setOpen(!open); }}>${open ? 'Hide why' : 'Why'}</button>` : null}
      </p>
      ${open && prop && PC ? h`<${PC} id=${prop} flat=${true} compact=${true} />` : null}
    </div>`;
  }

  function ReviewBar(p) {
    var React = R();
    var v = p.variant;
    var who = usePersona();
    var ns = React.useState(''), note = ns[0], setNote = ns[1];
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var r = reviewOf(v);
    var canApprove = can(who, 'copy'), canSubmit = can(who, 'submit');
    var last = (v.history || EMPTY).filter(function (x) { return x.kind === 'review'; }).slice(-1)[0];
    function act(review) {
      var res = dispatch('variant/setReview', { id: v.id, review: review, note: note.trim() || undefined });
      if (!res.ok) setMsg({ tone: 'crit', text: res.error || 'Couldn’t change the review state.' }); else { setMsg(null); setNote(''); }
    }
    if (r === 'approved') {
      return h`<p className="cs-review-line cs-muted">${last ? 'Copy approved by ' + personaName(last.by) + (last.note ? ': ' + last.note : '') + '.' : 'Copy approved.'}
        ${canSubmit ? h` <button type="button" className="cs-link" id="cs-reopen" onClick=${function () { act('in_review'); }}>Send back to review</button>` : null}</p>`;
    }
    var line = { draft: 'Draft. Send it to review before it can take traffic.', in_review: 'Waiting for review. It gets no traffic until it’s approved.',
      changes: 'Changes requested' + (last && last.note ? ': ' + last.note : '.') }[r];
    return h`<div className="cs-review">
      <p className="cs-review-line">${line}${p.dirty ? ' Save your edits first.' : ''}</p>
      <div className="cs-review-act">
        <input className="k-input cs-input cs-review-note" type="text" maxLength="240" aria-label="Review note (optional)" placeholder="Note (optional)" value=${note}
          onChange=${function (e) { setNote(e.target.value); }} />
        ${(r === 'draft' || r === 'changes') ? h`<${Btn} kind="primary" id="cs-submit-review" disabled=${!canSubmit || p.dirty} onClick=${function () { act('in_review'); }}>Submit for review<//>` : null}
        ${r === 'in_review' ? h`<${Btn} kind="primary" id="cs-approve" disabled=${!canApprove} onClick=${function () { act('approved'); }}>Approve<//>
          <${Btn} kind="secondary" id="cs-request-changes" disabled=${!canApprove} onClick=${function () { act('changes'); }}>Request changes<//>` : null}
      </div>
      ${r === 'in_review' && !canApprove ? h`<p className="cs-hint">Your role can’t approve copy. Switch to a content lead, brand approver or admin under Viewing as.</p>` : null}
      <${Msg} msg=${msg} />
    </div>`;
  }

  function VersionHistory(p) {
    var React = R();
    var v = p.variant;
    var open = React.useState(false), isOpen = open[0], setOpen = open[1];
    var now = useSel(function (w) { return w.meta.tick; });
    var hist = v.history || EMPTY;
    var rows = hist.map(function (e, i) {
      var prev = i > 0 ? hist.slice(0, i).reverse().filter(function (x) { return x.fields; })[0] : null;
      return { e: e, prev: prev };
    }).reverse();
    var n = hist.length;
    return h`<section className="cs-versions" aria-label="Version history">
      <button type="button" id="cs-versions-toggle" className="cs-link" aria-expanded=${isOpen ? 'true' : 'false'} onClick=${function () { setOpen(!isOpen); }}>
        ${isOpen ? 'Hide history' : 'History' + (n ? ' (' + n + ')' : '')}</button>
      ${isOpen ? (n ? h`<ol className="cs-vlist">${rows.map(function (x, k) {
        var e = x.e, when = relTime(e.tick, now);
        var head = e.kind === 'create' ? 'Created' : e.kind === 'review' ? (REVIEW_WORD[e.review] === 'Approved' ? 'Approved' : e.review === 'in_review' ? 'Sent to review' : e.review === 'changes' ? 'Changes requested' : 'Moved to draft') : 'Edited';
        var diffs = [];
        if (e.kind === 'edit' && x.prev) {
          Object.keys(Object.assign({}, x.prev.fields, e.fields)).forEach(function (f) {
            if (str(x.prev.fields[f]) !== str(e.fields[f])) diffs.push({ f: f, d: wordDiff(x.prev.fields[f], e.fields[f]) });
          });
        }
        return h`<li key=${k} className="cs-vrow">
          <p className="cs-vhead"><strong>${head}</strong> ${DOT} ${whoLabel(e.by)}${when ? ' ' + DOT + ' ' + when : ''}</p>
          ${e.note ? h`<p className="cs-vnote">${e.note}</p>` : null}
          ${diffs.map(function (d) {
            return h`<p key=${d.f} className="cs-vdiff"><span className="cs-vfield">${fieldLabel(d.f)}</span> ${d.d.map(function (t, j) {
              return t.t === 'same' ? t.s : t.t === 'add' ? h`<ins key=${j}>${t.s}</ins>` : h`<del key=${j}>${t.s}</del>`;
            })}</p>`;
          })}
        </li>`;
      })}</ol>` : h`<p className="cs-hint">No edits are recorded for this copy yet. Changes from now on appear here with who made them and why.</p>`) : null}
    </section>`;
  }

  function Composer(p) {
    var React = R();
    var S = p.S, d = S.d, v = p.variant, ch = d.channel;
    var brand = p.brand;
    var campaigns = useSel(function (w) { return w.campaigns; });
    var camp = v && campaigns ? campaigns.byId[v.campaignId] : null;
    var stats = useSel(function (w) {
      if (!v || v.status !== 'live') return null;
      var rows = sel('variantStats', w, v.campaignId, v.channel) || EMPTY;
      for (var i = 0; i < rows.length; i++) if (rows[i].id === v.id) return rows[i].sends;
      return null;
    });
    var lastField = React.useRef({ k: null, el: null, start: null, end: null });
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var opts = campaignOptions(campaigns, ch);
    var cidSt = React.useState(''), cidPick = cidSt[0], setCid = cidSt[1];
    var shSt = React.useState(0.2), share = shSt[0], setShare = shSt[1];
    var cid = opts.some(function (c) { return c.id === cidPick; }) ? cidPick : (opts[0] ? opts[0].id : '');
    var readOnly = !!v && (v.status === 'retired' || (camp && camp.status === 'completed'));
    var vlike = { channel: ch, fields: d.fields, tone: d.tone, offer: d.offer, productId: d.productId };
    var textFields = fieldsFor(ch).filter(function (k) { return k !== 'imageId' && k !== 'alt' && k !== 'link'; });

    function onFocusField(k, el) { lastField.current = { k: k, el: el, start: el.selectionStart, end: el.selectionEnd }; }
    function insert(tok) {
      var lf = lastField.current, k = lf.k && d.fields[lf.k] !== undefined ? lf.k : hookOf(ch);
      var cur = str(d.fields[k]);
      var s = fin(lf.start) && lf.k === k ? lf.start : cur.length, e = fin(lf.end) && lf.k === k ? lf.end : cur.length;
      var next = cur.slice(0, s) + tok + cur.slice(e);
      S.setField(k, next);
      lastField.current = { k: k, el: lf.el, start: s + tok.length, end: s + tok.length };
    }
    function pickImage(im) {
      S.update(function (cur) {
        var f = Object.assign({}, cur.fields), prev = has(CP(), 'imageById') ? CP().imageById(f.imageId) : null;
        f.imageId = im.id;
        if (!str(f.alt).trim() || (prev && f.alt === prev.alt)) f.alt = im.alt;
        return { fields: f };
      });
    }
    function changes() {
      var out = {}, n = 0;
      Object.keys(Object.assign({}, d.fields, d.baseFields)).forEach(function (k) {
        if (str(d.fields[k]) !== str(d.baseFields[k])) { out[k] = d.fields[k] === '' ? null : d.fields[k]; n++; }
      });
      return n ? out : null;
    }
    function saveInPlace() {
      var f = changes(); if (!f) return;
      var r = dispatch('variant/update', { id: v.id, fields: f, note: saveNote.trim() || undefined });
      if (!r.ok) { setMsg({ tone: 'crit', text: r.error || 'Couldn’t save.' }); return; }
      setSaveNote('');
      var nv = world() && world().variants.byId[v.id];
      S.markSaved(nv ? nv.ver : null);
      setMsg({ tone: 'good', text: 'Saved.' });
    }
    function createNew(campaignId, sh) {
      var payload = { variant: { campaignId: campaignId, channel: ch, fields: clone(d.fields), tone: d.tone, offer: d.offer, productId: d.productId } };
      if (fin(sh) && sh > 0) payload.share = sh;
      var r = dispatch('variant/create', payload);
      if (!r.ok) { setMsg({ tone: 'crit', text: r.error || 'Couldn’t add the variant.' }); return; }
      var nid = r.created && r.created[0];
      if (v) S.revert(); else { delete drafts[p.draftKey]; }
      if (nid) p.onCreated(nid, ch);
    }
    function saveAsNew() {
      var n = 0;
      if (camp && camp.alloc && camp.alloc[ch]) Object.keys(camp.alloc[ch]).forEach(function (k) { if (camp.alloc[ch][k] > 0) n++; });
      createNew(v.campaignId, n ? Math.round(100 / (n + 1)) / 100 : 0);
    }

    var hookLabel = v ? chLabel(v.channel) + ' ' + DOT + ' Variant ' + v.name : 'New ' + ({ email: 'email', sms: 'SMS', push: 'push', social: 'social ad', web: 'web ad' }[ch] || ch) + ' draft';
    var Conflict = MC.ui && MC.ui.ConflictChip;
    var upAgent = v ? agentOf(v.updatedBy) : null;
    var Pill = MC.ui && MC.ui.Pill;
    var stt = v ? stateOf(v) : null;
    var nsSt = React.useState(''), saveNote = nsSt[0], setSaveNote = nsSt[1];

    var saveRow;
    if (readOnly) saveRow = h`<p className="cs-note">${v.status === 'retired' ? 'This variant is retired, so it can’t be edited. Generate a new one below.' : 'Completed campaigns can’t be changed.'}</p>`;
    else if (!v) saveRow = h`<div className="cs-save">
        <${AddControls} idPrefix="cs-draft" channel=${ch} options=${opts} cid=${cid} setCid=${setCid} share=${share} setShare=${setShare} />
        <div className="cs-save-actions">
          <${Btn} kind="primary" id="cs-draft-add" disabled=${!cid || !S.dirty} onClick=${function () { createNew(cid, share); }}>Add to campaign<//>
          ${S.dirty ? h`<${Btn} kind="ghost" id="cs-revert" onClick=${S.revert}>Clear<//>` : null}
        </div>
      </div>`;
    else if (S.dirty && v.status === 'live') saveRow = h`<div className="cs-save">
        <p className="cs-warn"><${Icon} name="warn" size=${14} />
          <span>This variant is live in ${camp ? camp.name : 'its campaign'}. Saving changes resets what we’ve learned${fin(stats) && stats > 0 ? ' from ' + fmtNum(stats) + ' sends' : ''}.</span></p>
        <div className="cs-save-actions">
          <${Btn} kind="primary" id="cs-save-new" onClick=${saveAsNew}>Save as new variant<//>
          <${Btn} kind="secondary" id="cs-save-anyway" onClick=${saveInPlace}>Save anyway<//>
          <${Btn} kind="ghost" id="cs-revert" onClick=${S.revert}>Discard changes<//>
        </div>
      </div>`;
    else saveRow = h`<div className="cs-save cs-save-row">
        <span className="cs-muted">${S.dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <div className="cs-save-actions">
          <${Btn} kind="primary" id="cs-save" disabled=${!S.dirty} onClick=${saveInPlace}>Save<//>
          ${S.dirty ? h`<${Btn} kind="ghost" id="cs-revert" onClick=${S.revert}>Discard changes<//>` : null}
        </div>
      </div>`;

    return h`<section className="cs-composer" aria-labelledby="cs-composer-title">
      <header className="cs-comp-head">
        <div className="cs-comp-titles">
          <h2 id="cs-composer-title" className="cs-h2">${hookLabel}</h2>
          ${v && camp ? h`<p className="cs-sub">${camp.name}${v.status === 'live' && camp.alloc && camp.alloc[v.channel] ? ' ' + DOT + ' ' + fmtShare(camp.alloc[v.channel][v.id] || 0) + ' of ' + chWord(v.channel) + ' traffic' : ''}</p>`
            : h`<p className="cs-sub">Pick a variant on the left, or generate new ones below.</p>`}
        </div>
        ${v ? (Pill ? h`<${Pill} tone=${stt.tone}>${stt.label}<//>` : h`<span className="cs-muted">${stt.label}</span>`)
          : h`<${ChannelPicker} value=${ch} onChange=${p.onChannel} />`}
      </header>
      ${v ? h`<${AgentLine} variant=${v} />` : null}
      ${v && !readOnly ? h`<${ReviewBar} variant=${v} dirty=${S.dirty} />` : null}
      ${S.conflict && Conflict ? h`<${Conflict} agentId=${upAgent || undefined} who=${upAgent ? undefined : 'someone else'} onTheirs=${S.takeTheirs} onMine=${S.keepMine} />` : null}
      <div className="cs-fields">
        ${textFields.map(function (k) {
          return h`<${FieldRow} key=${k} k=${k} value=${d.fields[k]} limit=${limitFor(k, brand)} vlike=${vlike} readOnly=${readOnly}
            onChange=${S.setField} onFocusField=${onFocusField} />`;
        })}
        ${!readOnly ? h`<div className="cs-tokens" role="group" aria-label="Insert a merge field">
          <span className="cs-inline-label">Insert</span>
          ${(CP().TOKENS || TOKENS_FB).map(function (t) {
            var ins = t === '{first_name}' ? '{first_name|there}' : t;
            return h`<button key=${t} type="button" className="cs-token" onMouseDown=${function (e) { e.preventDefault(); }} onClick=${function () { insert(ins); }}>${ins}</button>`;
          })}
        </div>
        <p className="cs-hint">Add a fallback after a bar, like {first_name|there}. Leave it empty to drop the name when there isn’t one.</p>` : null}
        ${!readOnly ? h`<div className="cs-field cs-endfield">
          <label className="cs-label" htmlFor="cs-offer-end">Offer ends</label>
          <input id="cs-offer-end" className="k-input cs-input cs-date" type="date" value=${fin(p.endDay) ? dayYmd(p.endDay) : ''}
            onChange=${function (e) { S.update({ offerEnd: e.target.value ? ymdDay(e.target.value) : null }); }} />
          <p className="cs-hint">${fin(p.endDay) ? (fin(S.d.offerEnd) ? 'Set for this draft only.' : 'From the campaign dates.') + ' Deadline wording is checked against it.' : 'Add a date before using words like “last call” or “ends soon”. Urgency earns no score without one.'}</p>
        </div>` : null}
        ${d.fields.link !== undefined ? h`<${FieldRow} k="link" value=${d.fields.link} limit=${0} vlike=${vlike} readOnly=${readOnly} onChange=${S.setField} onFocusField=${onFocusField} />` : null}
        ${d.fields.imageId !== undefined ? h`<${ImagePicker} value=${d.fields.imageId} readOnly=${readOnly} onPick=${pickImage} />` : null}
        ${d.fields.alt !== undefined && d.fields.imageId ? h`<${FieldRow} k="alt" value=${d.fields.alt} limit=${limitFor('alt', brand)} vlike=${vlike} readOnly=${readOnly} onChange=${S.setField} onFocusField=${onFocusField} />` : null}
      </div>
      ${v && !readOnly && S.dirty ? h`<div className="cs-field cs-notefield">
        <label className="cs-label" htmlFor="cs-save-note">Note on this change (optional)</label>
        <input id="cs-save-note" className="k-input cs-input" type="text" maxLength="240" value=${saveNote} placeholder="Why you changed it"
          onChange=${function (e) { setSaveNote(e.target.value); }} />
      </div>` : null}
      ${saveRow}
      <${Msg} msg=${msg} />
      ${v ? h`<${VersionHistory} variant=${v} />` : null}
    </section>`;
  }

  /* ================= Generate variants ================= */
  function featureNote(d, ctx) {
    try {
      var s = CP().score(d, ctx);
      var pos = (s.contributions || EMPTY).filter(function (c) { return c.delta > 0; }).slice(0, 2).map(function (c) { return c.label; });
      return pos.join(' ' + DOT + ' ');
    } catch (e) { return ''; }
  }

  // Two sliders pick the voice: Practical to Adventurous, Warm to Urgent. The stronger lean leads; a real lean on
  // the other axis gets a share of the variants.
  function tonePlan(a, b, count) {
    var wA = Math.abs(a - 50) / 50, wB = Math.abs(b - 50) / 50;
    var tA = a < 50 ? 'practical' : (a > 50 ? 'adventurous' : 'practical'), tB = b < 50 ? 'warm' : 'urgent';
    if (wA < 0.1 && wB < 0.1) return [{ tone: 'practical', count: count }];
    var lead = wA >= wB ? { tone: tA, w: wA } : { tone: tB, w: wB }, other = wA >= wB ? { tone: tB, w: wB } : { tone: tA, w: wA };
    if (other.w < 0.25 || count < 2) return [{ tone: lead.tone, count: count }];
    var nOther = Math.max(1, Math.min(count - 1, Math.round(count * other.w / (lead.w + other.w))));
    return [{ tone: lead.tone, count: count - nOther }, { tone: other.tone, count: nOther }];
  }
  function toneWords(plan) {
    var L = CP().TONE_LABEL || {};
    var lc = function (t) { return (L[t] || t).toLowerCase(); };
    return plan.length > 1 ? 'Mostly ' + lc(plan[0].tone) + ', with some ' + lc(plan[1].tone) : 'In a ' + lc(plan[0].tone) + ' voice';
  }
  function slidersFor(tone) {
    return { practical: { a: 0, b: 50 }, adventurous: { a: 100, b: 50 }, warm: { a: 50, b: 0 }, urgent: { a: 50, b: 100 } }[tone] || { a: 0, b: 50 };
  }
  function lean(v, lo, hi) { return v === 50 ? 'Balanced' : (v < 50 ? 'Leaning ' + lo : 'Leaning ' + hi); }

  function GenField(p) {
    var id = p.id, lim = p.limit, len = measure(p.value, p.vlike), over = lim > 0 && len > lim;
    var common = { id: id, className: cx('k-input', MULTI[p.k] && 'k-textarea', 'cs-input', over && 'is-over'), value: p.value, 'aria-describedby': lim ? id + '-count' : null,
      onChange: function (e) { p.onChange(p.k, e.target.value); } };
    return h`<div className="cs-field">
      <div className="cs-field-head">
        <label className="cs-label" htmlFor=${id}>${fieldLabel(p.k)}</label>
        ${lim ? h`<span id=${id + '-count'} className=${cx('cs-counter num', over && 'is-over')}>${len}/${lim}</span>` : null}
      </div>
      ${MULTI[p.k] ? h`<textarea ...${common} rows=${Math.min(MULTI[p.k], 4)}></textarea>` : h`<input ...${common} type="text" />`}
    </div>`;
  }

  function Generator(p) {
    var React = R();
    var ch = p.channel, d = p.draft, brand = p.brand;
    var campaigns = useSel(function (w) { return w.campaigns; });
    var tick = useSel(function (w) { return w.meta.tick; });
    var gs = React.useState(genMemo), g = gs[0], setG = gs[1];
    function patchG(x) { setG(function (cur) { var n = Object.assign({}, cur, x, { form: genMemo.form }); genMemo = n; return n; }); }
    var os = React.useState(function () {
      if (genMemo.form && genMemo.form.key === p.formKey && genMemo.form.o && fin(genMemo.form.o.a)) return genMemo.form.o;
      var sl = slidersFor(d.tone || 'practical');
      return { a: sl.a, b: sl.b, offer: d.offer || 'none', productId: d.productId || '', count: 4, brief: '' };
    });
    var o = os[0], setO0 = os[1];
    function setO(fn) { setO0(function (cur) { var n = fn(cur); genMemo.form = { key: p.formKey, o: n }; return n; }); }
    var ls = React.useState({}), locks = ls[0], setLocks = ls[1];
    var bs = React.useState(false), busy = bs[0], setBusy = bs[1];
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var cmp = React.useState(false), compare = cmp[0], setCompare = cmp[1];
    var reqRef = React.useRef(0);
    var aliveRef = React.useRef(true);
    React.useEffect(function () { return function () { aliveRef.current = false; }; }, []);
    var opts = campaignOptions(campaigns, ch);
    var cidSt = React.useState(p.defaultCid || ''), cidPick = cidSt[0], setCid = cidSt[1];
    var shSt = React.useState(0.2), share = shSt[0], setShare = shSt[1];
    var cid = opts.some(function (c) { return c.id === cidPick; }) ? cidPick : (opts.some(function (c) { return c.id === p.defaultCid; }) ? p.defaultCid : (opts[0] ? opts[0].id : ''));
    var camp = campaigns && cid ? campaigns.byId[cid] : null;
    var gctx = { today: fin(tick) && MC.time ? MC.time.dayOf(tick) : undefined };
    var ce = dayEnd(camp);
    if (fin(d.offerEnd)) gctx.endDay = d.offerEnd; else if (ce !== null) { gctx.endDay = ce; gctx.startDay = Math.floor(camp.start / 24); }
    var lockable = fieldsFor(ch).filter(function (k) { return k !== 'imageId' && k !== 'alt' && k !== 'link' && MULTI[k] === undefined; });
    var results = (g.results || EMPTY).filter(function (r) { return r.channel === ch || (ch === 'web' && r.channel === 'social'); });
    var chosen = results.filter(function (r) { return g.selected[r.key]; });
    var offers = CP().OFFERS || ['none'];
    var products = (MC.data && MC.data.PRODUCTS) || EMPTY;
    var cats = (MC.data && MC.data.CATEGORIES) || EMPTY;
    var plan = tonePlan(o.a, o.b, o.count);
    var showOpens = ch === 'email';

    function set(k, v) { setO(function (cur) { var n = Object.assign({}, cur); n[k] = v; return n; }); }
    function generate() {
      var lk = {};
      Object.keys(locks).forEach(function (k) { if (locks[k] && str(d.fields[k]).trim()) lk[k] = d.fields[k]; });
      var n = g.n + 1, gch = ch === 'web' ? 'social' : ch, briefText = str(o.brief).trim();
      var live = (world() && world().variants ? Object.keys(world().variants.byId).map(function (id) { return world().variants.byId[id]; }) : EMPTY)
        .filter(function (v) { return v.status !== 'retired' && (v.channel === gch || (ch === 'web' && v.channel === 'web')); });
      var req = ++reqRef.current;
      setBusy(true); setMsg(null);
      var collected = [], skipped = 0;
      // One pass per tone; each pass asks for a few extra drafts so duplicates of live or earlier copy can be dropped.
      function pass(idx) {
        if (idx >= plan.length) return Promise.resolve();
        var entry = plan[idx], need = entry.count, attempt = 0;
        function once() {
          var genOpts = { channel: gch, tone: entry.tone, offer: o.offer, productId: o.productId || null, count: Math.min(8, need + 3), locks: lk,
            seedKey: ['studio', ch, entry.tone, o.offer, o.productId || 'any', n, idx, attempt].join(':') };
          if (briefText) { genOpts.brief = briefText; genOpts.notes = briefText; }
          return runGenerate(genOpts).then(function (list) {
            var dd = has(CP(), 'dedupe') ? CP().dedupe(list || EMPTY, live.concat(collected)) : { kept: list || EMPTY, dropped: [] };
            skipped += dd.dropped.length;
            var room = entry.count - collected.filter(function (x) { return x.tone === entry.tone; }).length;
            dd.kept.slice(0, Math.max(0, room)).forEach(function (x) { collected.push(x); });
            attempt++;
            var have = collected.filter(function (x) { return x.tone === entry.tone; }).length;
            if (have < entry.count && attempt < 3) return once();
          });
        }
        return once().then(function () { return pass(idx + 1); });
      }
      pass(0).then(function () {
        if (!aliveRef.current || req !== reqRef.current) return;
        setBusy(false);
        var res = collected.map(function (x, i) { return Object.assign({}, x, { key: n + ':' + i, name: String.fromCharCode(65 + i), note: featureNote(x, gctx) }); });
        res.sort(function (a, b) { return (b.predicted ? b.predicted.score : 0) - (a.predicted ? a.predicted.score : 0); });
        res.forEach(function (x, i) { x.name = String.fromCharCode(65 + i); });
        patchG({ results: res, n: n, selected: {}, open: {}, opts: { plan: plan, skipped: skipped } });
        if (res.length < o.count) setMsg({ tone: 'neutral', text: res.length ? 'Only ' + res.length + ' new ' + (res.length === 1 ? 'draft' : 'drafts') + ' differ from your live copy. Try another tone or product.' : 'Everything we wrote matched copy you already have. Try another tone or product.' });
      });
    }
    function toggle(key) { var s = Object.assign({}, g.selected); s[key] = !s[key]; patchG({ selected: s }); }
    function toggleOpen(key) { var s = Object.assign({}, g.open || {}); s[key] = !s[key]; patchG({ open: s }); }
    function editResult(key, k, val) {
      patchG({ results: (g.results || EMPTY).map(function (r) {
        if (r.key !== key) return r;
        var f = Object.assign({}, r.fields); f[k] = val;
        var nr = Object.assign({}, r, { fields: f });
        try { var s = CP().score(nr, gctx); nr.predicted = { score: s.score, open: s.predOpen, click: s.predClick }; } catch (e) { /* keep old */ }
        return nr;
      }) });
    }
    function fixResult(key, c) {
      var r = (g.results || EMPTY).filter(function (x) { return x.key === key; })[0];
      if (!r || !c || !c.fix) return;
      var v = r;
      for (var i = 0; i < 8; i++) {
        var cur = i === 0 ? c : CP().check(v, brand, gctx).filter(function (x) { return x.id === c.id; })[0];
        if (!cur || cur.status === 'pass' || !cur.fix) break;
        var nv = CP().applyFix(v, cur.fix);
        if (JSON.stringify(nv.fields) === JSON.stringify(v.fields)) break;
        v = nv;
      }
      patchG({ results: (g.results || EMPTY).map(function (x) {
        if (x.key !== key) return x;
        var nr = Object.assign({}, x, { fields: v.fields });
        try { var sc = CP().score(nr, gctx); nr.predicted = { score: sc.score, open: sc.predOpen, click: sc.predClick }; } catch (e) { /* keep old */ }
        return nr;
      }) });
    }
    function addChosen() {
      var ok = 0, err = null, firstId = null;
      chosen.forEach(function (r) {
        var res = dispatch('variant/create', { variant: { campaignId: cid, channel: ch, fields: clone(r.fields), tone: r.tone, offer: r.offer, productId: r.productId, predicted: r.predicted }, share: share });
        if (res.ok) { ok++; if (!firstId && res.created) firstId = res.created[0]; } else if (!err) err = res.error;
      });
      if (ok) {
        var name = (opts.filter(function (c) { return c.id === cid; })[0] || {}).name || 'the campaign';
        patchG({ selected: {}, results: (g.results || EMPTY).filter(function (r) { return !g.selected[r.key]; }) });
        setMsg({ tone: 'good', text: 'Added ' + ok + (ok === 1 ? ' variant' : ' variants') + ' to ' + name + '.', vid: firstId });
      } else setMsg({ tone: 'crit', text: err || 'Couldn’t add the variants.' });
    }

    var hook = hookOf(ch === 'web' ? 'social' : ch);
    var second = { email: 'preheader', sms: null, push: 'pushBody', social: 'socialText', web: 'socialText' }[ch];
    return h`<section className="cs-gen" aria-labelledby="cs-gen-title">
      <div className="cs-gen-head">
        <h2 id="cs-gen-title" className="cs-h2">Generate variants</h2>
        <p className="cs-sub">Fresh ${chWord(ch)} copy in the Fernway voice. Nothing is added until you choose.</p>
      </div>
      <div className="cs-gen-controls">
        <div className="cs-sliders cs-span-2">
          <div className="cs-slider">
            <div className="cs-slider-head"><label className="cs-label" htmlFor="cs-gen-a">Practical to adventurous</label><span className="cs-muted">${lean(o.a, 'practical', 'adventurous')}</span></div>
            <input id="cs-gen-a" className="cs-range" type="range" min="0" max="100" step="5" value=${o.a} aria-valuetext=${lean(o.a, 'practical', 'adventurous')}
              onChange=${function (e) { set('a', Number(e.target.value)); }} />
            <div className="cs-slider-ends" aria-hidden="true"><span>Practical</span><span>Adventurous</span></div>
          </div>
          <div className="cs-slider">
            <div className="cs-slider-head"><label className="cs-label" htmlFor="cs-gen-b">Warm to urgent</label><span className="cs-muted">${lean(o.b, 'warm', 'urgent')}</span></div>
            <input id="cs-gen-b" className="cs-range" type="range" min="0" max="100" step="5" value=${o.b} aria-valuetext=${lean(o.b, 'warm', 'urgent')}
              onChange=${function (e) { set('b', Number(e.target.value)); }} />
            <div className="cs-slider-ends" aria-hidden="true"><span>Warm</span><span>Urgent</span></div>
          </div>
          <p className="cs-note" id="cs-gen-tone-note">${toneWords(plan)}.${plan.some(function (x) { return x.tone === 'urgent'; }) ? ' Urgent copy needs an offer end date to score well.' : ''}</p>
        </div>
        <div className="cs-field cs-span-2">
          <label className="cs-label" htmlFor="cs-gen-brief">Brief <span className="cs-muted">(optional)</span></label>
          <input id="cs-gen-brief" className="k-input cs-input" type="text" maxLength="140" value=${o.brief || ''} placeholder="One line, for example: first frost, trail runners"
            onChange=${function (e) { set('brief', e.target.value); }} />
          <p className="cs-hint">Read by the AI writer when it’s on. The standard writer ignores it.</p>
        </div>
        <div className="cs-field">
          <label className="cs-label" htmlFor="cs-gen-offer">Offer</label>
          <select id="cs-gen-offer" className="k-select" value=${o.offer} onChange=${function (e) { set('offer', e.target.value); }}>
            ${offers.map(function (x) { return h`<option key=${x} value=${x}>${(CP().OFFER_LABEL || {})[x] || x}</option>`; })}
          </select>
        </div>
        <div className="cs-field">
          <label className="cs-label" htmlFor="cs-gen-product">Product</label>
          <select id="cs-gen-product" className="k-select" value=${o.productId || ''} onChange=${function (e) { set('productId', e.target.value); }}>
            <option value="">Whole store</option>
            ${cats.map(function (c) {
              var ps = products.filter(function (x) { return (typeof x.cat === 'string' ? x.cat : x.cat && x.cat.id) === c.id; });
              return ps.length ? h`<optgroup key=${c.id} label=${c.label}>${ps.map(function (x) { return h`<option key=${x.id} value=${x.id}>${x.name}</option>`; })}</optgroup>` : null;
            })}
          </select>
        </div>
        <div className="cs-field">
          <label className="cs-label" htmlFor="cs-gen-count">How many</label>
          <select id="cs-gen-count" className="k-select" value=${String(o.count)} onChange=${function (e) { set('count', Number(e.target.value)); }}>
            ${[3, 4, 5, 6].map(function (n) { return h`<option key=${n} value=${String(n)}>${n}</option>`; })}
          </select>
        </div>
        ${lockable.length ? h`<fieldset className="cs-locks cs-span-2">
          <legend className="cs-label">Lock (keep what you wrote)</legend>
          ${lockable.map(function (k) {
            var empty = !str(d.fields[k]).trim();
            return h`<label key=${k} className="cs-check" htmlFor=${'cs-lock-' + k}>
              <input type="checkbox" id=${'cs-lock-' + k} checked=${!!locks[k] && !empty} disabled=${empty}
                onChange=${function (e) { var n = Object.assign({}, locks); n[k] = e.target.checked; setLocks(n); }} />
              <span>${fieldLabel(k)}</span></label>`;
          })}
        </fieldset>` : null}
      </div>
      <div className="cs-gen-go">
        <${Btn} kind=${results.length ? 'secondary' : 'primary'} id="cs-generate" busy=${busy} onClick=${generate}>${results.length ? 'Generate again' : 'Generate ' + o.count}<//>
        <span className="cs-muted cs-busy" role="status" aria-live="polite">${busy ? 'Writing variants' + ELL : (results.length && g.n ? results.length + (results.length === 1 ? ' variant' : ' variants') + ' ready' : '')}</span>
      </div>
      ${results.length ? h`<div className="cs-results" aria-busy=${busy ? 'true' : 'false'}>
        <ul className="cs-result-list">${results.map(function (r) {
          var on = !!g.selected[r.key], openCard = !!(g.open && g.open[r.key]);
          var sid = 'cs-gen-' + r.key.replace(/[^a-z0-9]/gi, '-');
          var checks = openCard ? (function () { try { return CP().check(r, brand, gctx).filter(function (c) { return c.status !== 'pass'; }); } catch (e) { return EMPTY; } })() : EMPTY;
          var rlike = { channel: r.channel, fields: r.fields, tone: r.tone, offer: r.offer, productId: r.productId };
          var texts = fieldsFor(r.channel).filter(function (k) { return k !== 'imageId' && k !== 'alt' && k !== 'link'; });
          return h`<li key=${r.key} className=${cx('cs-result', on && 'is-on', openCard && 'is-open')}>
            <input type="checkbox" id=${sid + '-select'} className="cs-result-check" checked=${on} onChange=${function () { toggle(r.key); }}
              aria-label=${'Select variant ' + r.name} />
            <${Ring} value=${r.predicted ? r.predicted.score : null} size=${40} />
            <div className="cs-result-body">
              <label htmlFor=${sid + '-select'} className="cs-result-hook">${str(r.fields[hook])}</label>
              ${second && r.fields[second] ? h`<p className="cs-result-sub">${r.fields[second]}</p>` : null}
              ${r.note ? h`<p className="cs-result-note">${r.note}</p>` : null}
            </div>
            <button type="button" className="cs-link" id=${sid + '-toggle'} aria-expanded=${openCard ? 'true' : 'false'} aria-controls=${sid + '-full'}
              onClick=${function () { toggleOpen(r.key); }}>${openCard ? 'Hide message' : 'Full message'}</button>
            ${openCard ? h`<div className="cs-result-full" id=${sid + '-full'}>
              ${texts.map(function (k) {
                return h`<${GenField} key=${k} k=${k} id=${sid + '-f-' + k} value=${str(r.fields[k])} limit=${limitFor(k, brand)} vlike=${rlike} onChange=${function (kk, val) { editResult(r.key, kk, val); }} />`;
              })}
              ${checks.length ? h`<ul className="cs-result-issues">${checks.map(function (c) {
                return h`<li key=${c.id} className=${'is-' + c.status}><span><strong>${c.label}.</strong> ${c.detail}</span>
                  ${c.fix ? h`<button type="button" className="cs-link" onClick=${function () { fixResult(r.key, c); }}>Fix</button>` : null}</li>`;
              })}</ul>` : h`<p className="cs-note">No issues found.</p>`}
              <button type="button" className="cs-link" onClick=${function () { p.onEdit(r); }}>Open in composer</button>
            </div>` : null}
          </li>`;
        })}</ul>
        ${compare && chosen.length ? h`<div className="k-scroll-x"><table className="cs-compare">
          <caption className="sr-only">Selected variants compared</caption>
          <thead><tr><th scope="col">${fieldLabel(hook)}</th><th scope="col" className="is-num">Score</th>${showOpens ? h`<th scope="col" className="is-num">Opens</th>` : null}<th scope="col" className="is-num">Clicks</th></tr></thead>
          <tbody>${chosen.map(function (r) {
            return h`<tr key=${r.key}><td>${str(r.fields[hook])}</td><td className="is-num num">${r.predicted ? r.predicted.score : DASH}</td>
              ${showOpens ? h`<td className="is-num num">${r.predicted ? fmtPct(r.predicted.open) : DASH}</td>` : null}<td className="is-num num">${r.predicted ? fmtPct(r.predicted.click, 2) : DASH}</td></tr>`;
          })}</tbody></table></div>` : null}
        <div className="cs-addbar">
          <${AddControls} idPrefix="cs-add" channel=${ch} options=${opts} cid=${cid} setCid=${setCid} share=${share} setShare=${setShare} />
          <div className="cs-save-actions">
            <${Btn} kind="primary" id="cs-add-go" disabled=${!chosen.length || !cid} onClick=${addChosen}>${chosen.length ? 'Add ' + chosen.length + ' to campaign' : 'Add to campaign'}<//>
            <button type="button" id="cs-compare" className="cs-link" disabled=${chosen.length < 2} aria-pressed=${compare ? 'true' : 'false'}
              onClick=${function () { setCompare(!compare); }}>${compare ? 'Hide comparison' : 'Compare'}</button>
          </div>
        </div>
      </div>` : null}
      <${Msg} msg=${msg}>${msg && msg.vid ? h` <button type="button" className="cs-link" onClick=${function () { p.onOpen(msg.vid, ch); }}>Open</button>` : null}<//>
    </section>`;
  }

  /* ================= Preview ================= */
  function PreviewBody(p) {
    var f = p.f, ch = p.channel;
    if (ch === 'email') return h`<div className="cs-pv-email">
      <div className="cs-pv-inbox">
        <span className="cs-pv-from">Fernway Outfitters</span>
        <span className="cs-pv-subject">${f.subject || h`<span className="cs-muted">No subject</span>`}</span>
        <span className="cs-pv-pre">${f.preheader}</span>
      </div>
      <div className="cs-pv-mail">
        ${f.imageId ? h`<${Scene} imageId=${f.imageId} title=${f.alt} />` : null}
        ${f.headline ? h`<p className="cs-pv-headline">${f.headline}</p>` : null}
        <p className="cs-pv-text">${f.body}</p>
        ${f.cta ? h`<span className="cs-pv-cta">${f.cta}</span>` : null}
        ${f.link ? h`<span className="cs-pv-link">${f.link}</span>` : null}
      </div>
    </div>`;
    if (ch === 'sms') return h`<div className="cs-pv-sms">
      <span className="cs-pv-meta">Text message ${DOT} Fernway</span>
      <p className="cs-pv-bubble">${f.sms || h`<span className="cs-muted">Empty message</span>`}</p>
    </div>`;
    if (ch === 'push') return h`<div className="cs-pv-lock">
      <div className="cs-pv-push">
        <span className="cs-pv-meta"><span>Fernway</span><span>now</span></span>
        <p className="cs-pv-ptitle">${f.pushTitle}</p>
        <p className="cs-pv-pbody">${f.pushBody}</p>
      </div>
    </div>`;
    return h`<div className="cs-pv-ad">
      <span className="cs-pv-meta">Fernway Outfitters ${DOT} Sponsored</span>
      <p className="cs-pv-adtext">${f.socialText}</p>
      ${f.imageId ? h`<${Scene} imageId=${f.imageId} title=${f.alt} />` : null}
      <div className="cs-pv-adfoot">
        <div><span className="cs-pv-link">${str(f.link).split('/')[0]}</span><p className="cs-pv-adhead">${f.socialHeadline}</p></div>
        ${f.cta ? h`<span className="cs-pv-cta is-sm">${f.cta}</span>` : null}
      </div>
    </div>`;
  }

  function PreviewPane(p) {
    var React = R();
    var people = useSel(function (w) { return sel('previewProfiles', w); }) || EMPTY;
    var idx = p.profileIdx;
    var rendered = React.useMemo(function () {
      try {
        if (has(CP(), 'render')) {
          if (idx === 'none') return CP().render(p.vlike, world(), -1, { name: '' });
          if (idx === 'long') return CP().render(p.vlike, world(), -1, { name: CP().LONG_NAME || 'Maximilian-Alexander' });
          return CP().render(p.vlike, world(), idx);
        }
      } catch (e) { /* raw */ }
      return p.vlike.fields;
    }, [p.fieldsKey, idx, p.vlike.productId, p.vlike.offer]);
    var score = React.useMemo(function () {
      try { return has(CP(), 'score') ? CP().score(p.vlike, p.ctx) : null; } catch (e) { return null; }
    }, [p.fieldsKey, p.vlike.tone, p.vlike.offer, p.vlike.productId, p.ctx && p.ctx.endDay]);
    var smsInfo = p.vlike.channel === 'sms' && has(CP(), 'smsInfo') ? CP().smsInfo(str(rendered.sms)) : null;
    var hookEmpty = !str(p.vlike.fields[hookOf(p.vlike.channel)]).trim();
    if (hookEmpty) score = null;
    var contrib = score ? (score.contributions || EMPTY).slice(0, 6) : EMPTY;
    var maxAbs = contrib.reduce(function (m, c) { return Math.max(m, Math.abs(c.delta)); }, 1);
    var ch = p.vlike.channel === 'web' ? 'social' : p.vlike.channel;
    return h`<div className="cs-pane">
      <div className="cs-pane-head">
        <h2 className="cs-h2" id="cs-preview-title">Preview</h2>
        <div className="cs-previewas">
          <label className="cs-inline-label" htmlFor="cs-preview-as">Preview as</label>
          <select id="cs-preview-as" className="k-select" value=${String(idx)}
            onChange=${function (e) { var v = e.target.value; p.setProfileIdx(v === 'none' || v === 'long' ? v : Number(v)); }}>
            ${people.map(function (x) { return h`<option key=${x.idx} value=${String(x.idx)}>${x.name}</option>`; })}
            <option value="none">No first name on file</option>
            <option value="long">Very long first name</option>
          </select>
        </div>
      </div>
      <div className="cs-preview" aria-labelledby="cs-preview-title"><${PreviewBody} f=${rendered} channel=${ch} /></div>
      ${smsInfo ? h`<p className=${cx('cs-sms-meta num', smsInfo.encoding === 'Unicode' && 'is-warn')}>${smsInfo.encoding} ${DOT} ${smsInfo.segments} ${smsInfo.segments === 1 ? 'segment' : 'segments'} ${DOT} ${smsInfo.units} of ${smsInfo.perSegment} characters${smsInfo.encoding === 'Unicode' ? ' (a special character such as a curly quote forces Unicode)' : ''}</p>` : null}
      <div className="cs-score">
        <h3 className="cs-h3">Predicted engagement</h3>
        <div className="cs-score-row">
          <${Ring} value=${score ? score.score : null} size=${52} />
          <div>
            <p className="cs-score-num num">${score ? score.score : DASH}<span className="cs-muted"> / 100</span></p>
            <p className="cs-muted num">${hookEmpty ? 'Write or generate copy to see a prediction.' : ''}${score ? (ch === 'email' ? 'About ' + fmtPct(score.predOpen) + ' open and ' + fmtPct(score.predClick, 2) + ' click' : 'About ' + fmtPct(score.predClick, 2) + ' click') : ''}</p>
          </div>
        </div>
        ${contrib.length ? h`<div className="cs-why">
          <h4 className="cs-h4">Why this score</h4>
          <ul className="cs-why-list">${contrib.map(function (c) {
            var w = Math.max(4, Math.round(Math.abs(c.delta) / maxAbs * 100));
            return h`<li key=${c.key || c.label} className="cs-why-row">
              <span className=${cx('cs-why-delta num', c.delta < 0 && 'is-neg')}>${c.delta > 0 ? '+' : MINUS}${Math.abs(Math.round(c.delta))}</span>
              <span className="cs-why-label">${c.label}</span>
              <span className="cs-why-track" aria-hidden="true"><span className=${cx('cs-why-bar', c.delta < 0 && 'is-neg')} style=${{ width: w + '%' }}></span></span>
            </li>`;
          })}</ul>
        </div>` : null}
      </div>
    </div>`;
  }

  var CHECK_ICON = { pass: 'check-circle', warn: 'warn', fail: 'x-circle' };
  function ChecksPane(p) {
    var React = R();
    var checks = React.useMemo(function () {
      try { return has(CP(), 'check') ? CP().check(p.vlike, p.brand, p.ctx) : EMPTY; } catch (e) { return EMPTY; }
    }, [p.fieldsKey, p.brand, p.vlike.offer, p.vlike.productId, p.ctx && p.ctx.endDay, p.ctx && p.ctx.today]);
    var v = p.variant;
    var perf = useSel(function (w) {
      if (!v || (v.status !== 'live' && v.status !== 'paused')) return null;
      var rows = sel('variantStats', w, v.campaignId, v.channel) || EMPTY;
      for (var i = 0; i < rows.length; i++) if (rows[i].id === v.id) return rows[i];
      return null;
    });
    var fixes = checks.filter(function (c) { return c.fix && c.status !== 'pass'; });
    var issues = checks.filter(function (c) { return c.status !== 'pass'; }).length;
    var passed = checks.length - issues, vch = p.vlike.channel === 'web' ? 'social' : p.vlike.channel;
    var headline = checks.length ? passed + (passed === 1 ? ' check' : ' checks') + ' passed' + (issues ? ' ' + DOT + ' ' + issues + ' to review' : '') + ' ' + DOT + ' claims ' + (p.reviewed ? 'reviewed' : 'not reviewed') : '';
    return h`<div className="cs-pane">
      <div className="cs-pane-head">
        <h2 className="cs-h2">Brand & compliance</h2>
      </div>
      <p className="cs-headline num" id="cs-checks-headline">${headline}</p>
      ${checks.length && !p.readOnly ? h`<button type="button" id="cs-claims-review" className="cs-link cs-review" aria-pressed=${p.reviewed ? 'true' : 'false'} onClick=${p.onReview}>${p.reviewed ? 'Claims reviewed. Undo' : 'Mark claims as reviewed'}</button>` : null}
      <ul className="cs-checks">${checks.map(function (c) {
        return h`<li key=${c.id} className=${'cs-check-row is-' + c.status}>
          <span className="cs-check-icon" role="img" aria-label=${c.status === 'pass' ? 'Passed' : c.status === 'warn' ? 'Warning' : 'Failed'}><${Icon} name=${CHECK_ICON[c.status]} size=${16} /></span>
          <div className="cs-check-body"><p className="cs-check-label">${c.label}</p><p className="cs-check-detail">${c.detail}</p></div>
          ${c.fix && c.status !== 'pass' && !p.readOnly ? h`<${Btn} kind="ghost" size="sm" id=${'cs-fix-' + c.id} onClick=${function () { p.onFix(c); }}>Fix<//>` : null}
        </li>`;
      })}</ul>
      ${fixes.length > 1 && !p.readOnly ? h`<button type="button" id="cs-fix-all" className="cs-link" onClick=${p.onFixAll}>Fix all ${fixes.length}</button>` : null}
      ${perf ? h`<div className="cs-perf">
        <h3 className="cs-h3">Live performance</h3>
        ${!(perf.sends > 0) ? h`<p className="cs-muted">Not sent yet.</p>` : vch === 'email' ? h`<dl className="cs-perf-grid">
          <div><dt>Sends</dt><dd className="num">${fmtNum(perf.sends)}</dd></div>
          <div><dt>Open rate</dt><dd className="num">${fmtPct(perf.openRate)}</dd></div>
          <div><dt>Click rate</dt><dd className="num">${fmtPct(perf.clickRate, 2)}</dd></div>
          <div><dt>Traffic</dt><dd className="num">${fmtShare(perf.share)}</dd></div>
        </dl>` : h`<dl className="cs-perf-grid">
          <div><dt>Sends</dt><dd className="num">${fmtNum(perf.sends)}</dd></div>
          <div><dt>Clicks</dt><dd className="num">${fmtNum(perf.clicks)} <span className="cs-muted">${fmtPct(perf.clickRate, 2)}</span></dd></div>
          <div><dt>Conversions</dt><dd className="num">${fmtNum(perf.conv)}</dd></div>
          <div><dt>Traffic</dt><dd className="num">${fmtShare(perf.share)}</dd></div>
        </dl>`}
        ${fin(perf.pBest) && perf.sends > 0 ? h`<p className="cs-muted num">${fmtPct(perf.pBest, 0)} chance it’s the best ${chWord(v.channel)} variant.</p>` : null}
      </div>` : null}
    </div>`;
  }

  /* ================= Studio (composer + preview share one draft) ================= */
  function Studio(p) {
    var React = R();
    var S = useStudioDraft(p.draftKey, p.variant, p.channel);
    var d = S.d;
    var brandRaw = useSel(function (w) { return w.guardrails ? w.guardrails.brand : null; });
    var brandRev = useBrandRev();
    var brand = React.useMemo(function () { return effectiveBrand(brandRaw); }, [brandRaw, brandRev]);
    var tick = useSel(function (w) { return w.meta.tick; });
    var rs = React.useState(0), setRev = rs[1];
    var pi = React.useState(viewMemo.profileIdx || 0), profileIdx = pi[0], setPi = pi[1];
    var phone = useMedia('(max-width: 639px)');
    var ts = React.useState('compose'), tab = ts[0], setTab = ts[1];
    var vlike = { channel: d.channel, fields: d.fields, tone: d.tone, offer: d.offer, productId: d.productId };
    var fieldsKey = JSON.stringify(d.fields);
    var v = p.variant;
    var campaigns = useSel(function (w) { return w.campaigns; });
    var camp = v && campaigns ? campaigns.byId[v.campaignId] : null;
    var readOnly = !!v && (v.status === 'retired' || (camp && camp.status === 'completed'));

    // Dates for deadline checks: this draft's own end date, else the campaign's offer end.
    var ce = dayEnd(camp), ctx = { today: fin(tick) && MC.time ? MC.time.dayOf(tick) : undefined };
    if (fin(d.offerEnd)) ctx.endDay = d.offerEnd; else if (ce !== null) { ctx.endDay = ce; ctx.startDay = Math.floor(camp.start / 24); }
    var reviewed = viewMemo.reviewed[p.draftKey] === fieldsKey;

    function setProfileIdx(i) { viewMemo.profileIdx = i; setPi(i); }
    // One click fixes every occurrence the check flagged, across all fields.
    function fix(c) {
      if (!has(CP(), 'applyFix')) return;
      var v = vlike;
      for (var i = 0; i < 8; i++) {
        var cur = i === 0 ? c : CP().check(v, brand, ctx).filter(function (x) { return x.id === c.id; })[0];
        if (!cur || cur.status === 'pass' || !cur.fix) break;
        var nv = CP().applyFix(v, cur.fix);
        if (JSON.stringify(nv.fields) === JSON.stringify(v.fields)) break;
        v = nv;
      }
      S.update({ fields: v.fields });
    }
    function fixAll() { if (has(CP(), 'fixAll')) S.update({ fields: CP().fixAll(vlike, brand, ctx).fields }); }
    function toggleReview() { if (reviewed) delete viewMemo.reviewed[p.draftKey]; else viewMemo.reviewed[p.draftKey] = fieldsKey; setRev(function (x) { return x + 1; }); }

    var composer = h`<div className="cs-col cs-col-compose">
      <${Composer} S=${S} variant=${v} brand=${brand} endDay=${ctx.endDay} draftKey=${p.draftKey} onChannel=${p.onChannel} onCreated=${p.onCreated} />
      <${Generator} key=${d.channel} formKey=${p.draftKey} channel=${d.channel} draft=${d} brand=${brand} defaultCid=${v ? v.campaignId : ''} onEdit=${p.onEditGenerated} onOpen=${p.onCreated} />
    </div>`;
    var preview = h`<${PreviewPane} vlike=${vlike} ctx=${ctx} fieldsKey=${fieldsKey} profileIdx=${profileIdx} setProfileIdx=${setProfileIdx} />`;
    var checks = h`<${ChecksPane} vlike=${vlike} ctx=${ctx} reviewed=${reviewed} onReview=${toggleReview} fieldsKey=${fieldsKey} brand=${brand} variant=${v} readOnly=${readOnly} onFix=${fix} onFixAll=${fixAll} />`;

    if (phone) {
      var Tabs = MC.ui && MC.ui.Tabs;
      var tabs = [{ id: 'compose', label: 'Compose' }, { id: 'preview', label: 'Preview' }, { id: 'checks', label: 'Checks' }];
      return h`<div className="cs-studio is-phone">
        ${Tabs ? h`<${Tabs} id="cs-tabs" label="Content Studio panes" tabs=${tabs} value=${tab} onChange=${setTab} panelId="cs-phone-panel" />` : null}
        <div id="cs-phone-panel" role="tabpanel" aria-labelledby=${'cs-tabs-' + tab}>
          ${tab === 'preview' ? h`<div className="cs-col cs-col-side">${preview}</div>` : tab === 'checks' ? h`<div className="cs-col cs-col-side">${checks}</div>` : composer}
        </div>
      </div>`;
    }
    return h`<div className="cs-studio">
      ${composer}
      <aside className="cs-col cs-col-side" aria-label="Preview and checks">${preview}<hr className="cs-rule" />${checks}</aside>
    </div>`;
  }

  /* ================= Brand voice ================= */
  function BrandVoice() {
    var React = R();
    var brandRaw = useSel(function (w) { return w.guardrails ? w.guardrails.brand : null; });
    var rev = useBrandRev();
    var banned = (brandRaw && brandRaw.banned) || (CP().DEFAULT_BRAND && CP().DEFAULT_BRAND.banned) || EMPTY;
    var claims = claimsNow(), swaps = CP().SAFE_SWAP || {}, voice = CP().VOICE || { pillars: [], pairs: [] };
    var ws = React.useState(''), word = ws[0], setWord = ws[1];
    var ss = React.useState(''), swap = ss[0], setSwap = ss[1];
    var cs = React.useState(''), ctext = cs[0], setCtext = cs[1];
    var ps = React.useState(''), csrc = ps[0], setCsrc = ps[1];
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    function saveBanned(list) {
      var r = dispatch('guardrails/update', { patch: { brand: { banned: list } } });
      if (!r.ok) setMsg({ tone: 'crit', text: r.error || 'Couldn’t save the banned words.' }); else setMsg(null);
      return r.ok;
    }
    function addWord() {
      var w = word.trim();
      if (!w || banned.some(function (x) { return x.toLowerCase() === w.toLowerCase(); })) { setMsg({ tone: 'crit', text: w ? '“' + w + '” is already banned.' : 'Type a word or phrase first.' }); return; }
      if (saveBanned(banned.concat([w]))) { if (swap.trim()) swaps[w.toLowerCase()] = swap.trim(); setWord(''); setSwap(''); }
    }
    function addClaim() {
      var t = ctext.trim();
      if (!t || !csrc.trim()) { setMsg({ tone: 'crit', text: 'A claim needs its wording and a source.' }); return; }
      var id = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'claim-' + (claims.length + 1);
      setClaims(claims.concat([{ id: id, text: t, source: csrc.trim() }]));
      setCtext(''); setCsrc(''); setMsg(null);
    }
    return h`<div className="cs-voice" data-rev=${rev}>
      <section className="cs-vsec" aria-labelledby="cs-v-pillars">
        <h2 className="cs-h2" id="cs-v-pillars">Voice pillars</h2>
        <ul className="cs-pillars">${voice.pillars.map(function (x) {
          return h`<li key=${x.id} className="cs-pillar"><p className="cs-pillar-t">${x.title}</p><p className="cs-note">${x.text}</p></li>`;
        })}</ul>
      </section>
      <section className="cs-vsec" aria-labelledby="cs-v-pairs">
        <h2 className="cs-h2" id="cs-v-pairs">Do and don’t</h2>
        <ul className="cs-pairs">${voice.pairs.map(function (x, k) {
          return h`<li key=${k} className="cs-pair">
            <p className="cs-pair-dont"><span className="cs-pair-tag">Don’t</span> ${x.dont}</p>
            <p className="cs-pair-do"><span className="cs-pair-tag">Do</span> ${x.doText}</p>
            <p className="cs-muted">${x.why}</p>
          </li>`;
        })}</ul>
      </section>
      <section className="cs-vsec" aria-labelledby="cs-v-banned">
        <h2 className="cs-h2" id="cs-v-banned">Banned words</h2>
        <p className="cs-sub">Saved to your guardrails. Swaps are suggestions used by Fix and apply in this browser.</p>
        <ul className="cs-rows">${banned.map(function (b) {
          var sw = swaps[b.toLowerCase()];
          return h`<li key=${b} className="cs-row">
            <span className="cs-row-main"><strong>${b}</strong> ${sw !== undefined ? h`<span className="cs-muted">${' swap: '}</span><span>${sw || 'remove'}</span>` : h`<span className="cs-muted"> no swap, Fix removes it</span>`}</span>
            <button type="button" className="cs-link" aria-label=${'Remove ' + b} onClick=${function () { saveBanned(banned.filter(function (x) { return x !== b; })); }}>Remove</button>
          </li>`;
        })}</ul>
        <div className="cs-addrow">
          <div className="cs-field"><label className="cs-label" htmlFor="cs-v-word">Word or phrase</label>
            <input id="cs-v-word" className="k-input cs-input" type="text" maxLength="30" value=${word} onChange=${function (e) { setWord(e.target.value); }} /></div>
          <div className="cs-field"><label className="cs-label" htmlFor="cs-v-swap">Swap (optional)</label>
            <input id="cs-v-swap" className="k-input cs-input" type="text" maxLength="40" value=${swap} onChange=${function (e) { setSwap(e.target.value); }} /></div>
          <${Btn} kind="secondary" id="cs-v-addword" onClick=${addWord}>Add word<//>
        </div>
      </section>
      <section className="cs-vsec" aria-labelledby="cs-v-claims">
        <h2 className="cs-h2" id="cs-v-claims">Approved claims</h2>
        <p className="cs-sub">Copy can state these. Superlatives, performance numbers, stock claims and policy promises that aren’t listed fail the checks. Every change is logged with who made it.</p>
        <ul className="cs-rows">${claims.map(function (c) {
          return h`<li key=${c.id} className="cs-row">
            <span className="cs-row-main"><strong>${c.text}</strong><span className="cs-muted cs-row-src">Source: ${c.source}</span></span>
            <button type="button" className="cs-link" aria-label=${'Remove claim ' + c.text} onClick=${function () { setClaims(claims.filter(function (x) { return x.id !== c.id; })); }}>Remove</button>
          </li>`;
        })}${claims.length ? null : h`<li className="cs-muted">No approved claims yet.</li>`}</ul>
        <div className="cs-addrow">
          <div className="cs-field"><label className="cs-label" htmlFor="cs-v-claim">Claim</label>
            <input id="cs-v-claim" className="k-input cs-input" type="text" maxLength="80" value=${ctext} onChange=${function (e) { setCtext(e.target.value); }} /></div>
          <div className="cs-field"><label className="cs-label" htmlFor="cs-v-source">Source</label>
            <input id="cs-v-source" className="k-input cs-input" type="text" maxLength="80" placeholder="Policy or product spec" value=${csrc} onChange=${function (e) { setCsrc(e.target.value); }} /></div>
          <${Btn} kind="secondary" id="cs-v-addclaim" onClick=${addClaim}>Add claim<//>
        </div>
      </section>
      <${Msg} msg=${msg} />
    </div>`;
  }

  /* ================= View ================= */
  function ContentView() {
    var React = R();
    var ready = useSel(function (w) { return !!(w && w.variants && w.campaigns); });
    var focus = MC.hooks.useUi(function (s) { return s.focus && s.focus.content; }) || {};
    // Open on the composer with real work: the first live variant, unless the marketer asked for a new draft.
    var fallbackVid = useSel(function (w) {
      if (viewMemo.wantNew) return null;
      var lib = sel('variantLibrary', w) || EMPTY;
      for (var i = 0; i < lib.length; i++) {
        if (lib[i].status !== 'live') continue;
        for (var j = 0; j < lib[i].variants.length; j++) if (lib[i].variants[j].status === 'live') return lib[i].variants[j].id;
      }
      return null;
    });
    var vid = focus.variantId || fallbackVid || null;
    var variant = useSel(function (w) { return vid ? w.variants.byId[vid] || null : null; });
    var channel = COMPOSE_CHANNELS.indexOf(focus.channel) >= 0 || focus.channel === 'web' ? focus.channel : 'email';
    var wide = useMedia('(min-width: 1200px)');
    var ls = React.useState(false), libOpen = ls[0], setLibOpen = ls[1];
    var rs = React.useState(viewMemo.newRev), newRev = rs[0], setNewRev = rs[1];
    var tb = React.useState(viewMemo.tab || 'studio'), tab = tb[0], setTab0 = tb[1];
    function setTab(t) { viewMemo.tab = t; setTab0(t); }
    var Seg = MC.ui && MC.ui.Segmented;
    var TABS = [{ value: 'studio', label: 'Studio' }, { value: 'voice', label: 'Brand voice' }];
    var missing = !!focus.variantId && ready && !variant;
    var ch = variant ? variant.channel : channel;
    var key = draftKey(variant ? variant.id : null, ch);

    function select(id, c) { viewMemo.wantNew = false; setFocus({ variantId: id, channel: c }); if (!wide) setLibOpen(false); }
    function startNew(c) { viewMemo.wantNew = true; setFocus({ variantId: null, channel: c || channel }); if (!wide) setLibOpen(false); }
    function editGenerated(r) {
      var c = r.channel || ch;
      var base = blankFields(c);
      drafts[draftKey(null, c)] = { channel: c, fields: normFields(c, r.fields), baseFields: base, baseVer: null, tone: r.tone, offer: r.offer, productId: r.productId };
      viewMemo.newRev++; setNewRev(viewMemo.newRev); viewMemo.wantNew = true;
      setFocus({ variantId: null, channel: c });
    }

    var library = h`<${Library} selectedId=${variant ? variant.id : null} onSelect=${select} onNew=${function () { startNew(ch); }} />`;
    var body;
    if (!ready) body = h`<p className="cs-empty">Loading Fernway content${ELL}</p>`;
    else if (missing) body = h`<div className="cs-removed"><p>This variant was removed.</p>
      <${Btn} kind="secondary" onClick=${function () { startNew(channel); }}>Start a new draft<//></div>`;
    else body = h`<${Studio} key=${key + ':' + newRev} draftKey=${key} variant=${variant} channel=${ch}
      onChannel=${function (c) { startNew(c); }} onCreated=${select} onEditGenerated=${editGenerated} />`;

    return h`<section className="v-content">
      <header className="cs-header">
        <h1 id="page-title" tabIndex="-1" className="cs-title">Content Studio <span className="mc-art-tag">made and maintained by your agents</span></h1>
        ${variant ? h`<${MadeBy} kind="campaign" id=${variant.campaignId} />` : null}
        ${Seg ? h`<${Seg} id="cs-tab" label="Content sections" size="sm" options=${TABS} value=${tab} onChange=${setTab} />`
          : h`<select id="cs-tab" className="k-select" aria-label="Content sections" value=${tab} onChange=${function (e) { setTab(e.target.value); }}>${TABS.map(function (t) { return h`<option key=${t.value} value=${t.value}>${t.label}</option>`; })}</select>`}
        ${!wide && tab === 'studio' ? h`<button type="button" id="cs-lib-toggle" className="cs-libbar" aria-expanded=${libOpen ? 'true' : 'false'} aria-controls="cs-lib-drop"
            onClick=${function () { setLibOpen(!libOpen); }}>
            <span>${variant ? 'Library ' + DOT + ' ' + chLabel(variant.channel) + ' ' + variant.name : 'Library'}</span><${Icon} name=${libOpen ? 'chevron-up' : 'chevron-down'} size=${14} /></button>` : null}
      </header>
      ${tab === 'voice' ? h`<${BrandVoice} />` : h`<div>
        ${!wide && libOpen ? h`<div id="cs-lib-drop" className="cs-lib-drop">${library}</div>` : null}
        <div className=${cx('cs-layout', wide && 'is-wide')}>
          ${wide ? h`<div className="cs-col cs-col-lib">${library}</div>` : null}
          <div className="cs-main">${body}</div>
        </div>
      </div>`}
    </section>`;
  }

  MC.views.content = ContentView;
  MC.content.drafts = function () { return Object.keys(drafts).filter(isDirtyKey); };
})();
