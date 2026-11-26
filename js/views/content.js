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

  /* ---------------- module memory (never written to the world) ---------------- */
  var drafts = {};             // key -> {fields, baseFields, baseVer, tone, offer, productId, channel}
  var genMemo = { results: [], opts: null, n: 0, selected: {} };
  var viewMemo = { newRev: 0 };
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
      ${open && PC ? h`<div className="cs-agentnote-list">${list.map(function (p) { return h`<${PC} key=${p.id} id=${p.id} compact=${true} showTarget=${true} />`; })}</div>` : null}
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

    function hookText(v) {
      var full = variants && variants.byId[v.id];
      return full ? str(full.fields && full.fields[hookOf(full.channel)]) : '';
    }
    var groups = lib.map(function (g) {
      var vs = g.variants.filter(function (v) {
        if (v.status === 'retired' && v.id !== p.selectedId) return false;
        if (filter === 'draft' && v.status !== 'draft') return false;
        if (filter === 'live' && v.status !== 'live') return false;
        if (filter === 'agent' && !agentOf(v.author)) return false;
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
      return h`<li key=${v.id}>
        <button type="button" id=${'cs-lib-' + v.id} className=${cx('cs-lib-row', on && 'is-on')} aria-current=${on ? 'true' : null}
          onClick=${function () { p.onSelect(v.id, v.channel); }}>
          <span className="cs-lib-name">
            <span className=${'cs-sdot is-' + v.status} aria-hidden="true"></span>
            <span className="cs-lib-title">${chLabel(v.channel)} ${v.name}</span>
            ${ag ? h`<span className="cs-adot" title=${'Drafted by ' + agentName(ag)}><span className="sr-only">${' drafted by ' + agentName(ag)}</span></span>` : null}
            <span className="cs-lib-meta num">${STATUS_WORD[v.status] || v.status}${v.status === 'live' ? ' ' + DOT + ' ' + fmtShare(v.share) : ''}${dirty ? ' ' + DOT + ' unsaved' : ''}</span>
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
      <${CopyDrafterNote} />
      ${!lib.length ? h`<p className="cs-empty">No content yet. Start from a campaign or generate variants from a tone and product.</p>`
        : !groups.length ? h`<p className="cs-empty">Nothing matches. Try another search or filter.</p>`
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
      ${open && prop && PC ? h`<${PC} id=${prop} compact=${true} />` : null}
    </div>`;
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
      var r = dispatch('variant/update', { id: v.id, fields: f });
      if (!r.ok) { setMsg({ tone: 'crit', text: r.error || 'Couldn’t save.' }); return; }
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
    var StatusPill = MC.ui && MC.ui.StatusPill;

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
          ${v && camp ? h`<p className="cs-sub">${camp.name}${v.status === 'live' && camp.alloc && camp.alloc[v.channel] ? ' ' + DOT + ' ' + fmtShare(camp.alloc[v.channel][v.id] || 0) + ' of ' + chLabel(v.channel).toLowerCase() + ' traffic' : ''}</p>`
            : h`<p className="cs-sub">Pick a variant on the left, or generate new ones below.</p>`}
        </div>
        ${v ? (StatusPill ? h`<${StatusPill} status=${v.status} />` : h`<span className="cs-muted">${STATUS_WORD[v.status]}</span>`)
          : h`<${ChannelPicker} value=${ch} onChange=${p.onChannel} />`}
      </header>
      ${v ? h`<${AgentLine} variant=${v} />` : null}
      ${S.conflict && Conflict ? h`<${Conflict} agentId=${upAgent || undefined} who=${upAgent ? undefined : 'someone else'} onTheirs=${S.takeTheirs} onMine=${S.keepMine} />` : null}
      <div className="cs-fields">
        ${textFields.map(function (k) {
          return h`<${FieldRow} key=${k} k=${k} value=${d.fields[k]} limit=${limitFor(k, brand)} vlike=${vlike} readOnly=${readOnly}
            onChange=${S.setField} onFocusField=${onFocusField} />`;
        })}
        ${!readOnly ? h`<div className="cs-tokens" role="group" aria-label="Insert a merge field">
          <span className="cs-inline-label">Insert</span>
          ${(CP().TOKENS || TOKENS_FB).map(function (t) {
            return h`<button key=${t} type="button" className="cs-token" onMouseDown=${function (e) { e.preventDefault(); }} onClick=${function () { insert(t); }}>${t}</button>`;
          })}
        </div>` : null}
        ${d.fields.link !== undefined ? h`<${FieldRow} k="link" value=${d.fields.link} limit=${0} vlike=${vlike} readOnly=${readOnly} onChange=${S.setField} onFocusField=${onFocusField} />` : null}
        ${d.fields.imageId !== undefined ? h`<${ImagePicker} value=${d.fields.imageId} readOnly=${readOnly} onPick=${pickImage} />` : null}
        ${d.fields.alt !== undefined && d.fields.imageId ? h`<${FieldRow} k="alt" value=${d.fields.alt} limit=${limitFor('alt', brand)} vlike=${vlike} readOnly=${readOnly} onChange=${S.setField} onFocusField=${onFocusField} />` : null}
      </div>
      ${saveRow}
      <${Msg} msg=${msg} />
    </section>`;
  }

  /* ================= Generate variants ================= */
  function featureNote(d) {
    try {
      var s = CP().score(d);
      var pos = (s.contributions || EMPTY).filter(function (c) { return c.delta > 0; }).slice(0, 2).map(function (c) { return c.label; });
      return pos.join(' ' + DOT + ' ');
    } catch (e) { return ''; }
  }

  function Generator(p) {
    var React = R();
    var ch = p.channel, d = p.draft;
    var Seg = MC.ui && MC.ui.Segmented;
    var campaigns = useSel(function (w) { return w.campaigns; });
    var gs = React.useState(genMemo), g = gs[0], setG = gs[1];
    function patchG(x) { setG(function (cur) { var n = Object.assign({}, cur, x, { form: genMemo.form }); genMemo = n; return n; }); }
    var os = React.useState(function () {
      return genMemo.form && genMemo.form.key === p.formKey ? genMemo.form.o : { tone: d.tone || 'practical', offer: d.offer || 'none', productId: d.productId || '', count: 4 };
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
    var lockable = fieldsFor(ch).filter(function (k) { return k !== 'imageId' && k !== 'alt' && k !== 'link' && MULTI[k] === undefined; });
    var results = (g.results || EMPTY).filter(function (r) { return r.channel === ch || (ch === 'web' && r.channel === 'social'); });
    var chosen = results.filter(function (r) { return g.selected[r.key]; });
    var tones = (CP().TONES || ['practical', 'adventurous', 'warm', 'urgent']).map(function (t) { return { value: t, label: (CP().TONE_LABEL || {})[t] || t }; });
    var offers = CP().OFFERS || ['none'];
    var products = (MC.data && MC.data.PRODUCTS) || EMPTY;
    var cats = (MC.data && MC.data.CATEGORIES) || EMPTY;

    function set(k, v) { setO(function (cur) { var n = Object.assign({}, cur); n[k] = v; return n; }); }
    function generate() {
      var lk = {};
      Object.keys(locks).forEach(function (k) { if (locks[k] && str(d.fields[k]).trim()) lk[k] = d.fields[k]; });
      var n = g.n + 1;
      var genOpts = { channel: ch === 'web' ? 'social' : ch, tone: o.tone, offer: o.offer, productId: o.productId || null, count: o.count, locks: lk,
        seedKey: ['studio', ch, o.tone, o.offer, o.productId || 'any', n].join(':') };
      var req = ++reqRef.current;
      setBusy(true); setMsg(null);
      runGenerate(genOpts).then(function (list) {
        if (!aliveRef.current || req !== reqRef.current) return;
        setBusy(false);
        var res = (list || EMPTY).map(function (x, i) { return Object.assign({}, x, { key: n + ':' + i, note: featureNote(x) }); });
        res.sort(function (a, b) { return (b.predicted ? b.predicted.score : 0) - (a.predicted ? a.predicted.score : 0); });
        patchG({ results: res, n: n, selected: {}, opts: genOpts });
      });
    }
    function toggle(key) { var s = Object.assign({}, g.selected); s[key] = !s[key]; patchG({ selected: s }); }
    function addChosen() {
      var ok = 0, err = null, firstId = null;
      chosen.forEach(function (r) {
        var res = dispatch('variant/create', { variant: { campaignId: cid, channel: ch, fields: clone(r.fields), tone: r.tone, offer: r.offer, productId: r.productId, predicted: r.predicted }, share: share });
        if (res.ok) { ok++; if (!firstId && res.created) firstId = res.created[0]; } else if (!err) err = res.error;
      });
      if (ok) {
        var name = (opts.filter(function (c) { return c.id === cid; })[0] || {}).name || 'the campaign';
        var keep = {}; patchG({ selected: keep });
        setMsg({ tone: 'good', text: 'Added ' + ok + (ok === 1 ? ' variant' : ' variants') + ' to ' + name + '.', vid: firstId });
      } else setMsg({ tone: 'crit', text: err || 'Couldn’t add the variants.' });
    }

    var hook = hookOf(ch === 'web' ? 'social' : ch);
    var second = { email: 'preheader', sms: null, push: 'pushBody', social: 'socialText', web: 'socialText' }[ch];
    return h`<section className="cs-gen" aria-labelledby="cs-gen-title">
      <div className="cs-gen-head">
        <h2 id="cs-gen-title" className="cs-h2">Generate variants</h2>
        <p className="cs-sub">Fresh ${chLabel(ch).toLowerCase()} copy in the Fernway voice. Nothing is added until you choose.</p>
      </div>
      <div className="cs-gen-controls">
        <div className="cs-field cs-span-2">
          <span className="cs-label" id="cs-gen-tone-label">Tone</span>
          ${Seg ? h`<${Seg} id="cs-gen-tone" label="Tone" size="sm" options=${tones} value=${o.tone} onChange=${function (v) { set('tone', v); }} />`
            : h`<select id="cs-gen-tone" className="k-select" value=${o.tone} onChange=${function (e) { set('tone', e.target.value); }}>${tones.map(function (t) { return h`<option key=${t.value} value=${t.value}>${t.label}</option>`; })}</select>`}
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
        ${busy ? h`<span className="cs-muted cs-busy">Writing variants${ELL}</span>` : null}
      </div>
      ${results.length ? h`<div className="cs-results">
        <ul className="cs-result-list">${results.map(function (r) {
          var on = !!g.selected[r.key];
          var sid = 'cs-gen-' + r.key.replace(/[^a-z0-9]/gi, '-');
          return h`<li key=${r.key} className=${cx('cs-result', on && 'is-on')}>
            <input type="checkbox" id=${sid + '-select'} className="cs-result-check" checked=${on} onChange=${function () { toggle(r.key); }}
              aria-label=${'Select variant ' + r.name} />
            <${Ring} value=${r.predicted ? r.predicted.score : null} size=${40} />
            <div className="cs-result-body">
              <label htmlFor=${sid + '-select'} className="cs-result-hook">${str(r.fields[hook])}</label>
              ${second && r.fields[second] ? h`<p className="cs-result-sub">${r.fields[second]}</p>` : null}
              ${r.note ? h`<p className="cs-result-note">${r.note}</p>` : null}
            </div>
            <button type="button" className="cs-link" onClick=${function () { p.onEdit(r); }}>Edit</button>
          </li>`;
        })}</ul>
        ${compare && chosen.length ? h`<div className="k-scroll-x"><table className="cs-compare">
          <caption className="sr-only">Selected variants compared</caption>
          <thead><tr><th scope="col">${fieldLabel(hook)}</th><th scope="col" className="is-num">Score</th><th scope="col" className="is-num">Opens</th><th scope="col" className="is-num">Clicks</th></tr></thead>
          <tbody>${chosen.map(function (r) {
            return h`<tr key=${r.key}><td>${str(r.fields[hook])}</td><td className="is-num num">${r.predicted ? r.predicted.score : DASH}</td>
              <td className="is-num num">${r.predicted ? fmtPct(r.predicted.open) : DASH}</td><td className="is-num num">${r.predicted ? fmtPct(r.predicted.click, 2) : DASH}</td></tr>`;
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
      try { if (has(CP(), 'render')) return CP().render(p.vlike, world(), idx); } catch (e) { /* raw */ }
      return p.vlike.fields;
    }, [p.fieldsKey, idx, p.vlike.productId, p.vlike.offer]);
    var score = React.useMemo(function () {
      try { return has(CP(), 'score') ? CP().score(p.vlike) : null; } catch (e) { return null; }
    }, [p.fieldsKey, p.vlike.tone, p.vlike.offer, p.vlike.productId]);
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
          <select id="cs-preview-as" className="k-select" value=${String(idx)} onChange=${function (e) { p.setProfileIdx(Number(e.target.value)); }}>
            ${people.map(function (x) { return h`<option key=${x.idx} value=${String(x.idx)}>${x.name}</option>`; })}
          </select>
        </div>
      </div>
      <div className="cs-preview" aria-labelledby="cs-preview-title"><${PreviewBody} f=${rendered} channel=${ch} /></div>
      <div className="cs-score">
        <h3 className="cs-h3">Predicted engagement</h3>
        <div className="cs-score-row">
          <${Ring} value=${score ? score.score : null} size=${52} />
          <div>
            <p className="cs-score-num num">${score ? score.score : DASH}<span className="cs-muted"> / 100</span></p>
            <p className="cs-muted num">${hookEmpty ? 'Write or generate copy to see a prediction.' : ''}${score ? 'About ' + fmtPct(score.predOpen) + ' open' + (ch === 'email' ? '' : 's') + ' and ' + fmtPct(score.predClick, 2) + ' click' : ''}</p>
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
      try { return has(CP(), 'check') ? CP().check(p.vlike, p.brand) : EMPTY; } catch (e) { return EMPTY; }
    }, [p.fieldsKey, p.brand, p.vlike.offer, p.vlike.productId]);
    var v = p.variant;
    var perf = useSel(function (w) {
      if (!v || (v.status !== 'live' && v.status !== 'paused')) return null;
      var rows = sel('variantStats', w, v.campaignId, v.channel) || EMPTY;
      for (var i = 0; i < rows.length; i++) if (rows[i].id === v.id) return rows[i];
      return null;
    });
    var fixes = checks.filter(function (c) { return c.fix && c.status !== 'pass'; });
    var issues = checks.filter(function (c) { return c.status !== 'pass'; }).length;
    return h`<div className="cs-pane">
      <div className="cs-pane-head">
        <h2 className="cs-h2">Brand & compliance</h2>
        <span className="cs-muted">${checks.length ? (issues ? issues + (issues === 1 ? ' to review' : ' to review') : 'All clear') : ''}</span>
      </div>
      <ul className="cs-checks">${checks.map(function (c) {
        return h`<li key=${c.id} className=${'cs-check-row is-' + c.status}>
          <span className="cs-check-icon" role="img" aria-label=${c.status === 'pass' ? 'Passed' : c.status === 'warn' ? 'Warning' : 'Failed'}><${Icon} name=${CHECK_ICON[c.status]} size=${16} /></span>
          <div className="cs-check-body"><p className="cs-check-label">${c.label}</p><p className="cs-check-detail">${c.detail}</p></div>
          ${c.fix && c.status !== 'pass' && !p.readOnly ? h`<${Btn} kind="ghost" size="sm" id=${'cs-fix-' + c.id} onClick=${function () { p.onFix(c.fix); }}>Fix<//>` : null}
        </li>`;
      })}</ul>
      ${fixes.length > 1 && !p.readOnly ? h`<button type="button" id="cs-fix-all" className="cs-link" onClick=${p.onFixAll}>Fix all ${fixes.length}</button>` : null}
      ${perf ? h`<div className="cs-perf">
        <h3 className="cs-h3">Live performance</h3>
        <dl className="cs-perf-grid">
          <div><dt>Sends</dt><dd className="num">${fmtNum(perf.sends)}</dd></div>
          <div><dt>Open rate</dt><dd className="num">${fmtPct(perf.openRate)}</dd></div>
          <div><dt>Click rate</dt><dd className="num">${fmtPct(perf.clickRate, 2)}</dd></div>
          <div><dt>Traffic</dt><dd className="num">${fmtShare(perf.share)}</dd></div>
        </dl>
        ${fin(perf.pBest) && perf.sends > 0 ? h`<p className="cs-muted num">${fmtPct(perf.pBest, 0)} chance it’s the best ${chLabel(v.channel).toLowerCase()} variant.</p>` : null}
      </div>` : null}
    </div>`;
  }

  /* ================= Studio (composer + preview share one draft) ================= */
  function Studio(p) {
    var React = R();
    var S = useStudioDraft(p.draftKey, p.variant, p.channel);
    var d = S.d;
    var brand = useSel(function (w) { return w.guardrails ? w.guardrails.brand : null; });
    var pi = React.useState(viewMemo.profileIdx || 0), profileIdx = pi[0], setPi = pi[1];
    var phone = useMedia('(max-width: 639px)');
    var ts = React.useState('compose'), tab = ts[0], setTab = ts[1];
    var vlike = { channel: d.channel, fields: d.fields, tone: d.tone, offer: d.offer, productId: d.productId };
    var fieldsKey = JSON.stringify(d.fields);
    var v = p.variant;
    var campaigns = useSel(function (w) { return w.campaigns; });
    var camp = v && campaigns ? campaigns.byId[v.campaignId] : null;
    var readOnly = !!v && (v.status === 'retired' || (camp && camp.status === 'completed'));

    function setProfileIdx(i) { viewMemo.profileIdx = i; setPi(i); }
    function fix(f) { if (has(CP(), 'applyFix')) S.update({ fields: CP().applyFix(vlike, f).fields }); }
    function fixAll() { if (has(CP(), 'fixAll')) S.update({ fields: CP().fixAll(vlike, brand).fields }); }

    var composer = h`<div className="cs-col cs-col-compose">
      <${Composer} S=${S} variant=${v} brand=${brand} draftKey=${p.draftKey} onChannel=${p.onChannel} onCreated=${p.onCreated} />
      <${Generator} key=${d.channel} formKey=${p.draftKey} channel=${d.channel} draft=${d} defaultCid=${v ? v.campaignId : ''} onEdit=${p.onEditGenerated} onOpen=${p.onCreated} />
    </div>`;
    var preview = h`<${PreviewPane} vlike=${vlike} fieldsKey=${fieldsKey} profileIdx=${profileIdx} setProfileIdx=${setProfileIdx} />`;
    var checks = h`<${ChecksPane} vlike=${vlike} fieldsKey=${fieldsKey} brand=${brand} variant=${v} readOnly=${readOnly} onFix=${fix} onFixAll=${fixAll} />`;

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
        <h1 id="page-title" tabIndex="-1" className="cs-title">Content Studio</h1>
        ${!wide ? h`<button type="button" id="cs-lib-toggle" className="cs-libbar" aria-expanded=${libOpen ? 'true' : 'false'} aria-controls="cs-lib-drop"
            onClick=${function () { setLibOpen(!libOpen); }}>
            <span>${variant ? 'Library ' + DOT + ' ' + chLabel(variant.channel) + ' ' + variant.name : 'Library'}</span><${Icon} name=${libOpen ? 'chevron-up' : 'chevron-down'} size=${14} /></button>` : null}
      </header>
      ${!wide && libOpen ? h`<div id="cs-lib-drop" className="cs-lib-drop">${library}</div>` : null}
      <div className=${cx('cs-layout', wide && 'is-wide')}>
        ${wide ? h`<div className="cs-col cs-col-lib">${library}</div>` : null}
        <div className="cs-main">${body}</div>
      </div>
    </section>`;
  }

  MC.views.content = ContentView;
  MC.content.drafts = function () { return Object.keys(drafts).filter(isDirtyKey); };
})();
