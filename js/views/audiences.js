/* Marketing Cloud · Audiences view (#audiences)
   Tabs: Segments · Builder · Profiles · Overlap. Owner: audiences lane.
   Drafts (rule builder, names, search) live in local state only; the store is written only on explicit actions. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};
  MC.audiences = MC.audiences || {};

  var EMPTY = [];
  var DOT = '·', DASH = '–', TIMES = '×', ELL = '…', ARROW = '→', MINUS = '−';

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
  function world() { return MC.store && typeof MC.store.getState === 'function' ? MC.store.getState() : null; }
  function seg() { return MC.segments || {}; }
  function has(obj, name) { return !!obj && typeof obj[name] === 'function'; }

  /* ---------------- formatting (MC.fmt with safe fallbacks) ---------------- */
  function fmtNum(n, o) {
    if (!fin(n)) return DASH;
    if (MC.fmt && MC.fmt.num) return MC.fmt.num(n, o);
    return String(Math.round(n));
  }
  function fmtPct(p, dp) {
    if (!fin(p)) return DASH;
    if (MC.fmt && MC.fmt.pct) return MC.fmt.pct(p, dp === undefined ? 0 : dp);
    return (p * 100).toFixed(dp || 0) + '%';
  }
  function fmtMoney(n, o) {
    if (!fin(n)) return DASH;
    if (MC.fmt && MC.fmt.money) return MC.fmt.money(n, o);
    return '$' + Math.round(n);
  }
  function fmtRatio(x) { return fin(x) ? (MC.fmt && MC.fmt.ratio ? MC.fmt.ratio(x) : x.toFixed(1) + TIMES) : DASH; }
  function fmtHour(hr) { return fin(hr) ? (MC.fmt && MC.fmt.hour ? MC.fmt.hour(hr) : hr + ':00') : DASH; }
  // Calendar labels come from MC.time's display mapping (§11.1).
  function fmtStamp(t) { return fin(t) ? (MC.time && MC.time.stampLabel ? MC.time.stampLabel(t) : (MC.fmt && MC.fmt.stamp ? MC.fmt.stamp(t) : DASH)) : DASH; }
  function fmtDayShort(d) { return fin(d) ? (MC.time && MC.time.dayLabel ? MC.time.dayLabel(d, { style: 'short' }) : (MC.fmt && MC.fmt.dayShort ? MC.fmt.dayShort(d) : DASH)) : DASH; }
  function plural(n, one, many) { return fmtNum(n) + ' ' + (n === 1 ? one : many); }
  function chLabel(ch) { return (MC.CH && MC.CH.LABEL && MC.CH.LABEL[ch]) || ch; }

  /* ---------------- store access ---------------- */
  function useSel(sel, eq) {
    var f = MC.hooks && MC.hooks.useSelect;
    var safe = function (w) { try { return w ? sel(w) : null; } catch (e) { return null; } };
    return f(safe, eq);
  }
  function dispatch(type, payload) {
    try {
      if (!MC.store || !has(MC.store, 'dispatch')) return { ok: false, error: 'The workspace is still starting up.' };
      return MC.store.dispatch({ type: type, payload: payload }) || { ok: false, error: 'No response.' };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }
  function setFocus(patch) {
    try {
      if (MC.uiStore && has(MC.uiStore, 'setFocus')) { MC.uiStore.setFocus('audiences', patch); return; }
      if (MC.uiStore && has(MC.uiStore, 'set')) {
        MC.uiStore.set(function (s) {
          var f = Object.assign({}, s.focus || {});
          f.audiences = Object.assign({}, f.audiences || {}, patch);
          return { focus: f };
        });
      }
    } catch (e) { /* focus is a convenience */ }
  }
  function go(route, patch) {
    try { if (MC.nav && has(MC.nav, 'go')) MC.nav.go(route, patch); else window.location.hash = '#' + route; } catch (e) { /* best effort */ }
  }
  function sel(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (!MC.select || !has(MC.select, name)) return null;
    try { return MC.select[name].apply(null, args); } catch (e) { return null; }
  }

  /* ---------------- kit lookups with small local fallbacks ---------------- */
  function FbButton(p) {
    var kind = p.kind || 'secondary';
    return h`<button type=${p.type || 'button'} id=${p.id} className=${'aud-btn aud-btn-' + kind + (p.size === 'sm' ? ' aud-btn-sm' : '')}
      onClick=${p.onClick} disabled=${p.disabled} title=${p.title} aria-label=${p['aria-label']}>${p.children}</button>`;
  }
  function FbTabs(p) {
    var React = R();
    function onKey(e, i) {
      var n = p.tabs.length, j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j < 0) return;
      e.preventDefault();
      p.onChange(p.tabs[j].id);
      var el = document.getElementById(p.id + '-' + p.tabs[j].id);
      if (el) el.focus();
    }
    return h`<div className="aud-tablist" role="tablist" id=${p.id} aria-label=${p.label || 'Sections'}>
      ${p.tabs.map(function (t, i) {
        var on = t.id === p.value;
        return h`<button key=${t.id} type="button" role="tab" id=${p.id + '-' + t.id} aria-selected=${on ? 'true' : 'false'}
          tabIndex=${on ? 0 : -1} className=${'aud-tab' + (on ? ' is-on' : '')} onClick=${function () { p.onChange(t.id); }}
          onKeyDown=${function (e) { onKey(e, i); }}>${t.label}${fin(t.count) ? h` <span className="aud-tab-count num">${fmtNum(t.count)}</span>` : null}</button>`;
      })}
    </div>`;
  }
  function FbSegmented(p) {
    function onKey(e, i) {
      var n = p.options.length, j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
      if (j < 0) return;
      e.preventDefault();
      p.onChange(p.options[j].value);
      var el = document.getElementById(p.id + '-' + p.options[j].value);
      if (el) el.focus();
    }
    return h`<div className="aud-seg" role="radiogroup" id=${p.id} aria-label=${p.label}>
      ${p.options.map(function (o, i) {
        var on = o.value === p.value;
        return h`<button key=${o.value} type="button" role="radio" id=${p.id + '-' + o.value} aria-checked=${on ? 'true' : 'false'}
          tabIndex=${on ? 0 : -1} className=${'aud-seg-opt' + (on ? ' is-on' : '')}
          onClick=${function () { p.onChange(o.value); }} onKeyDown=${function (e) { onKey(e, i); }}>${o.label}</button>`;
      })}
    </div>`;
  }
  function FbPill(p) { return h`<span className=${'aud-pill aud-pill-' + (p.tone || 'neutral')}>${p.children}</span>`; }
  function FbInlineConfirm(p) {
    return h`<div className="aud-confirm" role="group" aria-label="Confirm">
      <span>${p.message}</span>
      <${FbButton} kind=${p.tone === 'crit' ? 'danger' : 'primary'} size="sm" onClick=${p.onConfirm}>${p.confirmLabel || 'Confirm'}<//>
      <${FbButton} kind="ghost" size="sm" onClick=${p.onCancel}>${p.cancelLabel || 'Cancel'}<//>
    </div>`;
  }
  function FbDrawer(p) {
    var React = R();
    var ref = React.useRef(null);
    React.useEffect(function () {
      if (!p.open) return undefined;
      var prev = document.activeElement;
      if (ref.current) ref.current.focus();
      function onKey(e) { if (e.key === 'Escape') p.onClose(); }
      document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
    }, [p.open]);
    if (!p.open) return null;
    return h`<div className="aud-drawer-wrap">
      <div className="aud-drawer-scrim" onClick=${p.onClose}></div>
      <aside className="aud-drawer" role="dialog" aria-modal="true" aria-label=${p.title} tabIndex="-1" ref=${ref}>
        <div className="aud-drawer-head"><h2>${p.title}</h2>
          <button type="button" className="aud-x" aria-label="Close" onClick=${p.onClose}>${TIMES}</button></div>
        <div className="aud-drawer-body">${p.children}</div>
      </aside>
    </div>`;
  }
  var FALLBACK = { Button: FbButton, Tabs: FbTabs, Segmented: FbSegmented, Pill: FbPill, InlineConfirm: FbInlineConfirm, Drawer: FbDrawer };
  function ui(name) { return (MC.ui && MC.ui[name]) || FALLBACK[name] || null; }
  function chart(name) { return (MC.charts && MC.charts[name]) || null; }
  function Btn(p) { var B = ui('Button'); return h`<${B} ...${p}>${p.children}<//>`; }
  function Pill(p) { var P = ui('Pill'); return h`<${P} tone=${p.tone}>${p.children}<//>`; }
  function Chip(p) {
    var A = MC.ui && MC.ui.AgentChip;
    if (!p.agentId || p.agentId === 'user') return h`<span className="aud-you">You</span>`;
    return A ? h`<${A} agentId=${p.agentId} size="sm" />` : h`<span className="aud-agent-text">${p.agentId}</span>`;
  }
  function Msg(p) {
    if (!p.msg) return null;
    return h`<p className=${'aud-msg aud-msg-' + (p.msg.tone || 'neutral')} role=${p.msg.tone === 'crit' ? 'alert' : null}>${p.msg.text}${p.children}</p>`;
  }

  /* ---------------- attributes and rules ---------------- */
  var OP_LABEL = { gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most', between: 'between', in: 'is any of', notIn: 'is none of', is: 'is' };
  var OPS_BY_TYPE = { num: ['gt', 'gte', 'lt', 'lte', 'between'], cat: ['in', 'notIn'], bool: ['is'] };
  var GROUPS = ['Profile', 'Behavior', 'Predictions'];
  var DEFAULTS = {
    lastOrderDays: ['gt', 120], orders: ['gte', 2], spend: ['gte', 300], aov: ['gte', 100], visits30: ['gte', 2],
    affHike: ['gte', 0.3], affCamp: ['gte', 0.3], affClimb: ['gte', 0.3], affRun: ['gte', 0.3], affApparel: ['gte', 0.3],
    engRate: ['gte', 0.2], fatigue: ['lt', 2], sent7: ['lt', 3], prop: ['gte', 0.5], churn: ['gte', 0.5], ltv: ['gte', 480],
    bestHr: ['between', [17, 21]], age: ['between', [25, 44]], tenureDays: ['lt', 90]
  };
  var MAX_DEPTH = 3;

  function normValues(a) {
    var vals = a && a.values;
    if (!Array.isArray(vals)) return [];
    return vals.map(function (v) {
      if (typeof v === 'string' || typeof v === 'number') return { value: String(v), label: String(v) };
      return { value: String(v.value !== undefined ? v.value : (v.id !== undefined ? v.id : v.code)), label: v.label || v.name || String(v.value || v.id) };
    });
  }
  var attrCache = { src: null, list: [], byKey: {} };
  function attrs() {
    var src = seg().ATTRS;
    if (!Array.isArray(src)) return attrCache;
    if (attrCache.src === src) return attrCache;
    var list = src.map(function (a) {
      return {
        key: a.key, label: a.label || a.key, group: a.group || 'Profile', type: a.type || 'num',
        ops: Array.isArray(a.ops) && a.ops.length ? a.ops : OPS_BY_TYPE[a.type || 'num'],
        values: normValues(a), unit: a.unit || '', fmt: a.fmt, raw: a
      };
    });
    var byKey = {};
    list.forEach(function (a) { byKey[a.key] = a; });
    attrCache = { src: src, list: list, byKey: byKey };
    return attrCache;
  }
  function attrOf(key) { return attrs().byKey[key] || null; }
  function isPredicted(a) { return !!a && a.group === 'Predictions'; }
  function unitIsMoney(a) { return !!a && (a.unit === '$' || a.unit === 'usd' || a.key === 'spend' || a.key === 'aov' || a.key === 'ltv'); }
  function fmtAttrValue(a, v) {
    if (!a || !fin(v)) return String(v);
    if (typeof a.fmt === 'function') { try { return a.fmt(v); } catch (e) { /* fall through */ } }
    if (unitIsMoney(a)) return fmtMoney(v);
    if (a.key === 'bestHr') return fmtHour(v);
    return fmtNum(v, { dp: v % 1 ? 2 : 0 });
  }

  function newCond(key) {
    var a = attrOf(key) || attrs().list[0];
    if (!a) return { attr: key || 'lastOrderDays', cmp: 'gt', value: 120 };
    if (a.type === 'cat') return { attr: a.key, cmp: 'in', value: a.values.length ? [a.values[0].value] : [] };
    if (a.type === 'bool') return { attr: a.key, cmp: 'is', value: true };
    var d = DEFAULTS[a.key] || ['gte', 0];
    return { attr: a.key, cmp: d[0], value: Array.isArray(d[1]) ? d[1].slice() : d[1] };
  }
  function newGroup(op) { return { op: op || 'any', items: [newCond('state')] }; }
  function emptyRule() { return { op: 'all', items: [] }; }
  function isGroup(x) { return !!x && Array.isArray(x.items); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function updateAt(rule, path, fn) {
    if (!path.length) return fn(rule);
    var items = rule.items.slice();
    items[path[0]] = updateAt(items[path[0]], path.slice(1), fn);
    return Object.assign({}, rule, { items: items });
  }
  function removeAt(rule, path) {
    var parent = path.slice(0, -1), k = path[path.length - 1];
    return updateAt(rule, parent, function (g) {
      return Object.assign({}, g, { items: g.items.filter(function (_, i) { return i !== k; }) });
    });
  }
  function addTo(rule, path, item) {
    return updateAt(rule, path, function (g) { return Object.assign({}, g, { items: g.items.concat([item]) }); });
  }
  function condComplete(c) {
    if (!c || !attrOf(c.attr)) return false;
    if (c.cmp === 'in' || c.cmp === 'notIn') return Array.isArray(c.value) && c.value.length > 0;
    if (c.cmp === 'is') return typeof c.value === 'boolean';
    if (c.cmp === 'between') return Array.isArray(c.value) && fin(c.value[0]) && fin(c.value[1]) && c.value[0] <= c.value[1];
    return fin(c.value);
  }
  // Drops incomplete leaves (and groups emptied by that) so the live count always works on a valid rule.
  function prune(rule, acc) {
    var items = [];
    rule.items.forEach(function (x) {
      if (isGroup(x)) {
        var g = prune(x, acc);
        if (g.items.length) items.push(g); else if (x.items.length) acc.dropped++;
      } else if (condComplete(x)) items.push(x);
      else acc.dropped++;
    });
    return { op: rule.op, items: items };
  }
  function countLeaves(rule) {
    var n = 0;
    (rule.items || []).forEach(function (x) { n += isGroup(x) ? countLeaves(x) : 1; });
    return n;
  }
  function describeRule(rule) {
    if (!rule || !rule.items || !rule.items.length) return '';
    if (has(seg(), 'describe')) { try { return seg().describe(rule) || ''; } catch (e) { return ''; } }
    return '';
  }
  function pathKey(path) { return path.length ? path.join('-') : 'root'; }

  // Remembered builder draft so it survives tab switches and route changes (UI convenience only).
  var builderMemo = { rule: emptyRule(), name: '', editingId: null, text: '', parsed: null, prevRule: null };
  MC.audiences.openInBuilder = function (segmentId) {
    var w = world(), s = w && w.segments.byId[segmentId];
    if (!s) return false;
    builderMemo = { rule: clone(s.rule), name: s.name, editingId: s.id, text: '', parsed: null, prevRule: null, baseVer: s.ver };
    setFocus({ tab: 'builder', segmentId: s.id });
    builderListeners.forEach(function (fn) { fn(); });
    go('audiences');
    return true;
  };
  var builderListeners = [];

  /* ---------------- evaluation helpers ---------------- */
  function evaluate(w, rule) {
    if (!w || !has(seg(), 'evaluate')) return null;
    try { return seg().evaluate(w, rule); } catch (e) { return { error: String((e && e.message) || e) }; }
  }
  function validateRule(rule) {
    if (!has(seg(), 'validate')) return [];
    try { return seg().validate(rule) || []; } catch (e) { return [String((e && e.message) || e)]; }
  }
  function membersOf(w, segmentId) {
    if (!w || !has(seg(), 'members')) return null;
    try { return seg().members(w, segmentId); } catch (e) { return null; }
  }
  // Normalizes a histogram from traits() into [{x0,x1,count}].
  function toBins(hst, lo, hi) {
    if (!hst) return [];
    if (Array.isArray(hst.bins)) hst = hst.bins;
    if (!Array.isArray(hst) || !hst.length) return [];
    if (typeof hst[0] === 'object') return hst.map(function (b) { return { x0: b.x0, x1: b.x1, count: b.count !== undefined ? b.count : b.value }; });
    var step = (hi - lo) / hst.length;
    return hst.map(function (c, i) { return { x0: lo + i * step, x1: lo + (i + 1) * step, count: c }; });
  }
  // Normalizes a categorical distribution into [{key,label,value}].
  function toBars(d, labels) {
    if (!d) return [];
    if (Array.isArray(d)) {
      return d.map(function (x, i) {
        if (typeof x === 'number') return { key: String(i), label: (labels && labels[i]) || String(i), value: x };
        return { key: String(x.key || x.id || i), label: x.label || (labels && labels[i]) || String(x.key || x.id), value: x.count !== undefined ? x.count : x.value };
      });
    }
    return Object.keys(d).sort().map(function (k) { return { key: k, label: (labels && labels[k]) || k, value: d[k] }; });
  }
  function labelsFrom(list) {
    var out = {};
    (list || []).forEach(function (x, i) {
      var id = typeof x === 'string' ? x : (x.id || x.code);
      var lb = typeof x === 'string' ? x : (x.label || x.name || id);
      out[i] = lb; out[id] = lb;
    });
    return out;
  }

  /* ---------------- Builder: rule editor ---------------- */
  function NumInput(p) {
    // Text-backed so partial typing ("0.", "-") is never clobbered; commits numbers only.
    var React = R();
    var st = React.useState(fin(p.value) ? String(p.value) : '');
    var text = st[0], setText = st[1];
    var last = React.useRef(p.value);
    if (!Object.is(p.value, last.current)) {
      last.current = p.value;
      var want = fin(p.value) ? String(p.value) : '';
      if (!(fin(p.value) && Number(text) === p.value) && want !== text) setText(want);
    }
    return h`<input id=${p.id} className="aud-input aud-num num" type="text" inputMode="decimal" value=${text}
      aria-label=${p.label} onChange=${function (e) {
        var t = e.target.value; setText(t);
        var n = Number(t);
        if (t.trim() !== '' && isFinite(n)) { last.current = n; p.onChange(n); } else { last.current = NaN; p.onChange(NaN); }
      }} />`;
  }

  function CatPicker(p) {
    var a = p.attr, chosen = Array.isArray(p.value) ? p.value : [];
    var summary = chosen.length ? chosen.map(function (v) {
      var f = a.values.filter(function (x) { return x.value === v; })[0];
      return f ? f.label : v;
    }) : [];
    var text = summary.length ? (summary.length > 3 ? summary.slice(0, 3).join(', ') + ' +' + (summary.length - 3) : summary.join(', ')) : 'Choose values';
    function toggle(v) {
      var next = chosen.indexOf(v) >= 0 ? chosen.filter(function (x) { return x !== v; }) : chosen.concat([v]);
      p.onChange(next);
    }
    return h`<details className="aud-cat" id=${p.id}>
      <summary className="aud-input aud-cat-sum" aria-label=${p.label + ': ' + text}>${text}</summary>
      <div className="aud-cat-pop" role="group" aria-label=${p.label}>
        ${a.values.map(function (v) {
          var cid = p.id + '-' + v.value;
          return h`<label key=${v.value} className="aud-cat-opt" htmlFor=${cid}>
            <input type="checkbox" id=${cid} checked=${chosen.indexOf(v.value) >= 0} onChange=${function () { toggle(v.value); }} />
            <span>${v.label}</span></label>`;
        })}
      </div>
    </details>`;
  }

  function CondRow(p) {
    var c = p.cond, a = attrOf(c.attr), base = 'aud-c-' + pathKey(p.path);
    var list = attrs().list;
    function set(patch) { p.onChange(Object.assign({}, c, patch)); }
    function onAttr(e) { p.onChange(newCond(e.target.value)); }
    function onOp(e) {
      var cmp = e.target.value, v = c.value;
      if (cmp === 'between' && !Array.isArray(v)) v = [fin(v) ? v : 0, fin(v) ? v : 0];
      else if (cmp !== 'between' && Array.isArray(v) && a && a.type === 'num') v = v[0];
      set({ cmp: cmp, value: v });
    }
    var valueEl = null, label = a ? a.label : c.attr;
    if (!a) valueEl = h`<span className="aud-muted">Unknown attribute</span>`;
    else if (a.type === 'cat') valueEl = h`<${CatPicker} id=${base + '-val'} attr=${a} label=${label + ' values'} value=${c.value} onChange=${function (v) { set({ value: v }); }} />`;
    else if (a.type === 'bool') {
      valueEl = h`<select id=${base + '-val'} className="aud-input" aria-label=${label + ' value'} value=${c.value ? 'yes' : 'no'}
        onChange=${function (e) { set({ value: e.target.value === 'yes' }); }}>
        <option value="yes">Yes</option><option value="no">No</option></select>`;
    } else if (c.cmp === 'between') {
      var v2 = Array.isArray(c.value) ? c.value : [NaN, NaN];
      valueEl = h`<span className="aud-between">
        <${NumInput} id=${base + '-val'} label=${label + ' from'} value=${v2[0]} onChange=${function (n) { set({ value: [n, v2[1]] }); }} />
        <span className="aud-muted">and</span>
        <${NumInput} id=${base + '-val2'} label=${label + ' to'} value=${v2[1]} onChange=${function (n) { set({ value: [v2[0], n] }); }} />
      </span>`;
    } else {
      valueEl = h`<${NumInput} id=${base + '-val'} label=${label + ' value'} value=${c.value} onChange=${function (n) { set({ value: n }); }} />`;
    }
    var incomplete = !condComplete(c);
    return h`<li className=${'aud-cond' + (incomplete ? ' is-incomplete' : '')}>
      <select id=${base + '-attr'} className="aud-input aud-attr" aria-label="Attribute" value=${c.attr} onChange=${onAttr}>
        ${GROUPS.map(function (g) {
          var opts = list.filter(function (x) { return x.group === g; });
          if (!opts.length) return null;
          return h`<optgroup key=${g} label=${g}>${opts.map(function (x) {
            return h`<option key=${x.key} value=${x.key}>${x.label}${isPredicted(x) ? ' (Predicted)' : ''}</option>`;
          })}</optgroup>`;
        })}
      </select>
      ${isPredicted(a) ? h`<span className="aud-pred-badge">Predicted</span>` : null}
      <select id=${base + '-op'} className="aud-input aud-op" aria-label=${label + ' comparison'} value=${c.cmp} onChange=${onOp}>
        ${(a ? a.ops : [c.cmp]).map(function (o) { return h`<option key=${o} value=${o}>${OP_LABEL[o] || o}</option>`; })}
      </select>
      ${valueEl}
      ${a && unitIsMoney(a) && a.type === 'num' ? h`<span className="aud-unit">dollars</span>` : null}
      <button type="button" className="aud-x" id=${base + '-remove'} aria-label=${'Remove condition: ' + label} onClick=${p.onRemove}>${TIMES}</button>
      ${incomplete ? h`<span className="aud-hint">Finish this condition to count it.</span>` : null}
    </li>`;
  }

  function GroupBox(p) {
    var g = p.group, depth = p.path.length + 1, key = pathKey(p.path);
    var Seg = ui('Segmented');
    function change(fn) { p.onChange(fn); }
    return h`<div className=${'aud-group aud-depth-' + depth} role="group" aria-label=${(g.op === 'all' ? 'Match all of' : 'Match any of') + (depth > 1 ? ', nested group' : '')}>
      <div className="aud-group-head">
        <span className="aud-group-label">Match</span>
        <${Seg} id=${'aud-g-' + key + '-op'} label=${'Match all or any, ' + (depth > 1 ? 'nested group' : 'top level')} size="sm"
          options=${[{ value: 'all', label: 'all' }, { value: 'any', label: 'any' }]} value=${g.op}
          onChange=${function (v) { change(function (r) { return updateAt(r, p.path, function (x) { return Object.assign({}, x, { op: v }); }); }); }} />
        <span className="aud-group-label">of:</span>
        ${depth > 1 ? h`<button type="button" className="aud-x aud-group-x" id=${'aud-g-' + key + '-remove'} aria-label="Remove group"
          onClick=${function () { change(function (r) { return removeAt(r, p.path); }); }}>${TIMES}</button>` : null}
      </div>
      ${g.items.length ? h`<ul className="aud-items">
        ${g.items.map(function (x, i) {
          var path = p.path.concat([i]);
          // keys are positional paths; conditions have no ids and are only reordered by add/remove
          if (isGroup(x)) return h`<li key=${'g' + i} className="aud-subgroup"><${GroupBox} group=${x} path=${path} onChange=${p.onChange} /></li>`;
          return h`<${CondRow} key=${'c' + i + '-' + x.attr} cond=${x} path=${path}
            onChange=${function (nc) { change(function (r) { return updateAt(r, path, function () { return nc; }); }); }}
            onRemove=${function () { change(function (r) { return removeAt(r, path); }); }} />`;
        })}
      </ul>` : h`<p className="aud-muted aud-empty-group">${depth > 1 ? 'Empty group: matches everyone until you add a condition.' : 'No conditions yet.'}</p>`}
      <div className="aud-group-actions">
        <${Btn} kind="ghost" size="sm" id=${'aud-g-' + key + '-add'} onClick=${function () {
          var last = g.items.length ? g.items[g.items.length - 1] : null;
          change(function (r) { return addTo(r, p.path, newCond(last && !isGroup(last) ? last.attr : 'lastOrderDays')); });
        }}>+ Condition<//>
        ${depth < MAX_DEPTH ? h`<${Btn} kind="ghost" size="sm" id=${'aud-g-' + key + '-addgroup'}
          onClick=${function () { change(function (r) { return addTo(r, p.path, newGroup(g.op === 'all' ? 'any' : 'all')); }); }}>+ Group<//>` : null}
      </div>
    </div>`;
  }

  /* ---------------- Builder: live audience panel ---------------- */
  var BESTCH_LABELS = { 0: 'Email', 1: 'SMS', 2: 'Push', 3: 'None', 255: 'None', email: 'Email', sms: 'SMS', push: 'Push', none: 'None' };

  function maxLtv(w) {
    var P = w && w.profiles, m = 0;
    if (!P || !P.ltv) return 1;
    for (var i = 0; i < P.n; i++) if (P.ltv[i] > m) m = P.ltv[i];
    return m || 1;
  }

  function TraitBlock(p) {
    return h`<div className="aud-trait"><h4 className="aud-trait-title">${p.title}</h4>${p.children}</div>`;
  }

  function LiveAudience(p) {
    var w = p.world, ev = p.ev, total = w && w.profiles ? w.profiles.n : 0;
    var Hist = chart('Histogram'), Bar = chart('BarChart'), Hour = chart('HourStrip');
    if (!has(seg(), 'evaluate')) {
      return h`<div className="aud-live-empty"><p>Live counts appear once the segment engine has loaded.</p></div>`;
    }
    if (p.errors && p.errors.length) {
      return h`<div className="aud-live-empty"><p className="aud-msg aud-msg-warn">${p.errors[0]}</p></div>`;
    }
    if (!ev || ev.error) {
      return h`<div className="aud-live-empty"><p className="aud-msg aud-msg-crit">${ev && ev.error ? 'Couldn’t count this rule: ' + ev.error : 'Counting' + ELL}</p></div>`;
    }
    var count = ev.count, tr = p.traits;
    var head = h`<div className="aud-live-head">
      <p className="aud-big num"><strong>${fmtNum(count)}</strong> ${count === 1 ? 'person' : 'people'}</p>
      <p className="aud-muted num">${fmtPct(total ? count / total : 0)} of ${fmtNum(total)} ${DOT} Counted in ${fin(ev.ms) ? Math.max(1, Math.round(ev.ms)) : 1} ms${p.dropped ? ' ' + DOT + ' ' + plural(p.dropped, 'unfinished condition', 'unfinished conditions') + ' not counted' : ''}</p>
      <div className="aud-meter" aria-hidden="true"><span style=${{ width: (total ? Math.min(100, 100 * count / total) : 0) + '%' }}></span></div>
    </div>`;
    if (count === 0) {
      var elim = p.elims || [], best = null;
      elim.forEach(function (e) { if (!best || e.remaining > best.remaining) best = e; });
      return h`<div className="aud-live-inner">${head}
        <p className="aud-msg aud-msg-warn">No one matches.${best && best.remaining > 0 ? h` Loosen a condition ${DASH} the strictest is <em>${best.label}</em> (removes ${fmtPct(best.removedPct > 1 ? best.removedPct / 100 : best.removedPct)}). Without it, ${plural(best.remaining, 'person matches', 'people match')}.` : ' Loosen or remove a condition.'}</p>
      </div>`;
    }
    if (!tr) return h`<div className="aud-live-inner">${head}</div>`;
    var reach = tr.reach || {};
    var reachData = ['email', 'sms', 'push', 'ads'].map(function (k) {
      return { key: k, label: k === 'ads' ? 'Ads' : chLabel(k), value: reach[k] || 0 };
    });
    var D = MC.data || {};
    var tierBars = toBars(tr.tier, labelsFrom(D.TIERS));
    var regionBars = toBars(tr.region, labelsFrom(D.REGIONS));
    var bestBars = toBars(tr.bestCh, BESTCH_LABELS);
    var hist = tr.hist || {};
    var g = w.guardrails && w.guardrails.quiet;
    var sample = tr.sample ? Array.prototype.slice.call(tr.sample, 0, 5) : [];
    return h`<div className="aud-live-inner">
      ${head}
      <${TraitBlock} title="Reachable by">
        ${Bar ? h`<${Bar} data=${reachData} orientation="h" format="num" label="Reachable people by channel" noTable=${false} />`
          : h`<ul className="aud-plain">${reachData.map(function (d) { return h`<li key=${d.key}>${d.label}: <span className="num">${fmtNum(d.value)}</span></li>`; })}</ul>`}
      <//>
      <div className="aud-trait-grid">
        <${TraitBlock} title="Propensity to buy (30 days)">
          ${Hist ? h`<${Hist} bins=${toBins(hist.prop, 0, 1)} format="pct" label="Propensity distribution" color="chart-1" />` : null}
        <//>
        <${TraitBlock} title="Churn risk">
          ${Hist ? h`<${Hist} bins=${toBins(hist.churn, 0, 1)} format="pct" label="Churn risk distribution" color="chart-6" />` : null}
        <//>
        <${TraitBlock} title="Predicted LTV (12 months)">
          ${Hist ? h`<${Hist} bins=${toBins(hist.ltv, 0, p.ltvMax)} format="moneyCompact" label="Predicted lifetime value distribution" color="chart-2" />` : null}
        <//>
      </div>
      <div className="aud-trait-grid">
        <${TraitBlock} title="Tier">${Bar && tierBars.length ? h`<${Bar} data=${tierBars} format="num" label="Members by tier" />` : null}<//>
        <${TraitBlock} title="Best channel">${Bar && bestBars.length ? h`<${Bar} data=${bestBars} format="num" label="Members by predicted best channel" />` : null}<//>
      </div>
      ${regionBars.length ? h`<${TraitBlock} title="Region">${Bar ? h`<${Bar} data=${regionBars} format="num" label="Members by region" />` : null}<//>` : null}
      <${TraitBlock} title="Best send hour">
        ${Hour && tr.bestHr ? h`<${Hour} values=${Array.prototype.slice.call(tr.bestHr)} quiet=${g ? [g.start, g.end] : null} valueLabel="people" />` : null}
      <//>
      ${sample.length ? h`<${TraitBlock} title="Sample members">
        <ul className="aud-sample">${sample.map(function (i) {
          var nm = w.profiles.name[i], id = w.profiles.id[i];
          return h`<li key=${id}><button type="button" className="aud-link" onClick=${function () { p.onOpenProfile(i); }}>
            ${nm}</button> <span className="aud-mono">${id}</span></li>`;
        })}</ul>
      <//>` : null}
    </div>`;
  }

  /* ---------------- Builder: describe-your-audience ---------------- */
  function Describe(p) {
    var parsed = p.parsed;
    var canParse = has(seg(), 'parse');
    return h`<div className="aud-describe">
      <label className="aud-label" htmlFor="aud-describe">Describe your audience</label>
      <div className="aud-describe-row">
        <input id="aud-describe" className="aud-input aud-describe-input" type="text" value=${p.text}
          placeholder="e.g. lapsed hikers in the Pacific Northwest with high predicted LTV"
          onChange=${function (e) { p.onText(e.target.value); }}
          onKeyDown=${function (e) { if (e.key === 'Enter') { e.preventDefault(); p.onBuild(); } }} />
        <${Btn} kind="primary" id="aud-describe-build" onClick=${p.onBuild} disabled=${!canParse || !p.text.trim() || p.reading}>${p.reading ? 'Reading…' : 'Build rules'}<//>
      </div>
      <p className="aud-muted aud-reading" role="status" aria-live="polite">${p.reading ? 'Reading your description…' : ''}</p>
      ${!canParse ? h`<p className="aud-muted">The phrase parser is still loading; you can build rules by hand below.</p>` : null}
      ${parsed ? h`<div className="aud-parsed">
        ${parsed.matched && parsed.matched.length ? h`<div className="aud-parsed-row"><span className="aud-parsed-k">Understood:</span>
          <ul className="aud-plainlist">${parsed.matched.map(function (m, i) {
            return h`<li key=${i + '-' + m.phrase}><span className="aud-chip-phrase">${m.phrase}</span>: ${m.label}</li>`;
          })}</ul></div>` : parsed.why ? h`<p className="aud-muted aud-why">${parsed.why}</p>` : h`<p className="aud-msg aud-msg-warn">Nothing in that description matched an attribute. Try words like “lapsed”, “hikers”, “Pacific Northwest”, “Summit tier” or “high predicted LTV”.</p>`}
        ${parsed.ignored && parsed.ignored.length ? h`<div className="aud-parsed-row"><span className="aud-parsed-k">Ignored:</span>
          <p className="aud-muted">${parsed.ignored.map(function (t) { return '“' + t + '”'; }).join(', ')}</p></div>` : null}
        <div className="aud-parsed-foot">
          ${fin(parsed.confidence) && parsed.matched && parsed.matched.length ? h`<span className="aud-muted num">Confidence ${fmtPct(parsed.confidence)}</span>` : null}
          ${p.canUndo ? h`<span className="aud-muted">Replaces current rules ${DOT} </span>` : null}
          ${p.canUndo ? h`<button type="button" className="aud-link" id="aud-describe-undo" onClick=${p.onUndo}>Undo</button>` : null}
        </div>
      </div>` : null}
    </div>`;
  }

  /* ---------------- Builder tab ---------------- */
  function useBuilderState() {
    var React = R();
    var st = React.useState(builderMemo);
    var setSt = st[1];
    React.useEffect(function () {
      function sync() { setSt(builderMemo); }
      builderListeners.push(sync);
      return function () { builderListeners = builderListeners.filter(function (f) { return f !== sync; }); };
    }, []);
    function update(patch) {
      setSt(function (s) {
        var next = Object.assign({}, s, typeof patch === 'function' ? patch(s) : patch);
        builderMemo = next;
        return next;
      });
    }
    return [st[0], update];
  }

  function Builder(p) {
    var React = R();
    var pair = useBuilderState(), b = pair[0], update = pair[1];
    var segCounts = useSel(function (w) { return w.rev ? w.rev.segCounts : 0; });
    var segments = useSel(function (w) { return w.segments; });
    var campaigns = useSel(function (w) { return w.campaigns; });
    var msgSt = React.useState(null), msg = msgSt[0], setMsg = msgSt[1];
    var rdSt = React.useState(false), reading = rdSt[0], setReading = rdSt[1];
    var useSt = React.useState(''), useCid = useSt[0], setUseCid = useSt[1];
    var debounced = MC.hooks.useDebounced(b.rule, 150);
    var ruleKey = JSON.stringify(debounced);

    var live = React.useMemo(function () {
      var w = world();
      var acc = { dropped: 0 };
      var pr = prune(debounced, acc);
      var errors = validateRule(pr);
      var out = { rule: pr, dropped: acc.dropped, errors: errors, ev: null, traits: null, elims: null, world: w, ltvMax: maxLtv(w) };
      if (!w || errors.length) return out;
      out.ev = evaluate(w, pr);
      if (out.ev && !out.ev.error && out.ev.bits) {
        if (out.ev.count > 0 && has(seg(), 'traits')) { try { out.traits = seg().traits(w, out.ev.bits); } catch (e) { out.traits = null; } }
        if (out.ev.count === 0 && has(seg(), 'eliminations')) { try { out.elims = seg().eliminations(w, pr); } catch (e) { out.elims = null; } }
      }
      return out;
    }, [ruleKey, segCounts]);

    var editing = b.editingId && segments ? segments.byId[b.editingId] : null;
    var savedRule = editing ? JSON.stringify(editing.rule) : null;
    var dirty = !editing || savedRule !== JSON.stringify(b.rule) || editing.name !== b.name.trim();
    var plain = describeRule(live.rule);
    var leafCount = countLeaves(b.rule);

    function setRule(fn) { update(function (s) { return { rule: fn(s.rule) }; }); setMsg(null); }
    function build() {
      if (!has(seg(), 'parse') || !b.text.trim() || reading) return;
      var text = b.text;
      function apply(res) {
        if (!res || !res.rule) return;
        var suggested = !b.name.trim() && (res.name || (has(seg(), 'nameFor') && res.matched && res.matched.length ? seg().nameFor(res.rule) : null));
        update(function (s) {
          return { prevRule: s.rule, rule: clone(res.rule), parsed: res, name: (s.name && s.name.trim()) ? s.name : (suggested || s.name) };
        });
        setMsg(null);
      }
      var tasks = MC.ai && MC.ai.tasks;
      if (tasks && typeof tasks.segmentFromText === 'function' && MC.ai.isOn && MC.ai.isOn()) {
        setReading(true);
        setMsg(null);
        tasks.segmentFromText(text).then(function (res) { setReading(false); apply(res); },
          function () { setReading(false); setMsg({ tone: 'crit', text: 'Couldn’t read that description. Try again, or build the rules by hand below.' }); });
        return;
      }
      var res;
      try { res = seg().parse(text, world()); } catch (e) { setMsg({ tone: 'crit', text: 'Couldn’t read that description: ' + ((e && e.message) || e) }); return; }
      apply(res);
    }
    function undoParse() { update(function (s) { return s.prevRule ? { rule: s.prevRule, prevRule: null } : {}; }); }
    function startNew() { update({ rule: emptyRule(), name: '', editingId: null, parsed: null, prevRule: null, text: '' }); setMsg(null); }

    function save(asNew) {
      var name = b.name.trim();
      if (!name) { setMsg({ tone: 'warn', text: 'Give the segment a name first.' }); var el = document.getElementById('seg-name'); if (el) el.focus(); return null; }
      if (live.dropped) { setMsg({ tone: 'warn', text: 'Finish or remove the unfinished conditions before saving.' }); return null; }
      var r;
      if (editing && !asNew) {
        var payload = { id: editing.id };
        if (editing.name !== name) payload.name = name;
        if (savedRule !== JSON.stringify(b.rule)) payload.rule = clone(b.rule);
        if (payload.name === undefined && payload.rule === undefined) return editing.id;
        r = dispatch('segment/update', payload);
        if (!r.ok) { setMsg({ tone: 'crit', text: r.error || 'Couldn’t save the segment.' }); return null; }
        setMsg({ tone: 'good', text: 'Saved changes to “' + name + '”.' });
        return editing.id;
      }
      r = dispatch('segment/create', { segment: { name: name, rule: clone(b.rule) } });
      if (!r.ok) { setMsg({ tone: 'crit', text: r.error || 'Couldn’t save the segment.' }); return null; }
      var id = r.created && r.created[0];
      update({ editingId: id || null });
      var s2 = id && world() ? world().segments.byId[id] : null;
      setMsg({ tone: 'good', text: 'Saved “' + name + '”' + (s2 ? ' ' + DOT + ' ' + plural(s2.count, 'person', 'people') : '') + '. It’s ready to use in a campaign.' });
      return id;
    }
    function useInCampaign() {
      var c = campaigns && campaigns.byId[useCid];
      if (!c) { setMsg({ tone: 'warn', text: 'Pick a campaign first.' }); return; }
      var id = dirty ? save(false) : b.editingId;
      if (!id) return;
      var r, text;
      if (c.status === 'draft' || c.status === 'scheduled') {
        r = dispatch('campaign/setSegment', { id: c.id, segmentId: id });
        text = 'Now the audience of “' + c.name + '”.';
      } else {
        r = dispatch('campaign/include', { id: c.id, segmentId: id, on: true });
        text = 'Added to the audience of “' + c.name + '”. Members enroll at the next day roll.';
      }
      if (!r.ok) { setMsg({ tone: 'crit', text: r.error || 'Couldn’t update the campaign.' }); return; }
      setMsg({ tone: 'good', text: text, cid: c.id });
    }

    var usable = campaigns ? campaigns.order.map(function (id) { return campaigns.byId[id]; }).filter(function (c) { return c && c.status !== 'completed'; }) : [];
    var removed = b.editingId && segments && !segments.byId[b.editingId];

    return h`<div className="aud-builder">
      <${Describe} text=${b.text} parsed=${b.parsed} reading=${reading} canUndo=${!!b.prevRule}
        onText=${function (t) { update({ text: t }); }} onBuild=${build} onUndo=${undoParse} />
      <div className="aud-builder-grid">
        <section className="aud-rules aud-card" aria-labelledby="aud-rules-title">
          <div className="aud-card-head">
            <h2 id="aud-rules-title" className="aud-h2">${editing ? 'Editing “' + editing.name + '”' : 'Build rules'}</h2>
            ${b.editingId || leafCount ? h`<${Btn} kind="ghost" size="sm" id="aud-new" onClick=${startNew}>Start a new segment<//>` : null}
          </div>
          ${removed ? h`<p className="aud-msg aud-msg-warn">This segment was removed. Saving will create it again as a new segment.</p>` : null}
          ${!attrs().list.length ? h`<p className="aud-muted">The attribute list loads with the segment engine.</p>` : null}
          ${!leafCount && !b.rule.items.length ? h`<p className="aud-empty">Start by describing who you want to reach, or add a condition.</p>` : null}
          <${GroupBox} group=${b.rule} path=${[]} onChange=${setRule} />
          ${plain ? h`<div className="aud-plain-words"><h3 className="aud-h3">In plain words</h3><p>${plain}</p></div>` : null}
          <div className="aud-save">
            <div className="aud-field">
              <label className="aud-label" htmlFor="seg-name">Name</label>
              <input id="seg-name" className="aud-input" type="text" maxLength="60" value=${b.name}
                placeholder="e.g. Lapsed PNW hikers, high LTV" onChange=${function (e) { update({ name: e.target.value }); }} />
            </div>
            <div className="aud-save-actions">
              <${Btn} kind="primary" id="aud-save" onClick=${function () { save(false); }} disabled=${editing && !dirty}>${editing ? 'Save changes' : 'Save segment'}<//>
              ${editing ? h`<${Btn} kind="secondary" id="aud-save-new" onClick=${function () { save(true); }}>Save as new segment<//>` : null}
            </div>
            <div className="aud-use">
              <label className="aud-label" htmlFor="aud-use-campaign">Use in campaign</label>
              <div className="aud-use-row">
                <select id="aud-use-campaign" className="aud-input" value=${useCid} onChange=${function (e) { setUseCid(e.target.value); }}>
                  <option value="">Choose a campaign${ELL}</option>
                  ${usable.map(function (c) { return h`<option key=${c.id} value=${c.id}>${c.name} (${c.status})</option>`; })}
                </select>
                <${Btn} kind="secondary" id="aud-use-go" onClick=${useInCampaign} disabled=${!useCid}>Use in campaign<//>
              </div>
              <p className="aud-muted aud-small">Draft and scheduled campaigns switch to this audience; live campaigns add it alongside their current one.</p>
            </div>
            <${Msg} msg=${msg}>${msg && msg.cid ? h` <button type="button" className="aud-link" onClick=${function () { go('campaigns', { mode: 'detail', id: msg.cid, tab: 'audience' }); }}>Open campaign</button>` : null}<//>
          </div>
        </section>
        <aside className="aud-live aud-card" aria-labelledby="aud-live-title">
          <h2 id="aud-live-title" className="aud-h2">Live audience</h2>
          <${LiveAudience} world=${live.world} ev=${live.ev} traits=${live.traits} elims=${live.elims} errors=${live.errors}
            dropped=${live.dropped} ltvMax=${live.ltvMax} onOpenProfile=${p.onOpenProfile} />
        </aside>
      </div>
    </div>`;
  }

  /* ---------------- Segments tab: Scout suggestions ---------------- */
  function segAction(prop) {
    var acts = (prop && prop.actions) || [];
    for (var i = 0; i < acts.length; i++) if (acts[i].type === 'segment/create') return acts[i].payload && acts[i].payload.segment;
    return null;
  }

  function ScoutCard(p) {
    var React = R();
    var pr = p.proposal, s = segAction(pr);
    var errSt = React.useState(null), err = errSt[0], setErr = errSt[1];
    var moreSt = React.useState(false), more = moreSt[0], setMore = moreSt[1];
    var PC = MC.ui && MC.ui.ProposalCard;
    var plain = s ? describeRule(s.rule) : '';
    var evidence = pr.evidence || [];
    var includes = (pr.actions || []).some(function (a) { return a.type === 'campaign/include'; });
    function approve() {
      var r = dispatch('proposal/approve', { id: pr.id });
      if (!r.ok) setErr(r.error || 'Couldn’t create the segment.');
    }
    function dismiss() {
      var r = dispatch('proposal/reject', { id: pr.id, reason: 'not-now' });
      if (!r.ok) setErr(r.error || 'Couldn’t dismiss the suggestion.');
    }
    function edit() {
      if (!s) return;
      builderMemo = { rule: clone(s.rule), name: s.name || '', editingId: null, text: '', parsed: null, prevRule: null };
      builderListeners.forEach(function (fn) { fn(); });
      p.onTab('builder');
    }
    var alt = p.alt;
    return h`<article className="aud-scout-card" aria-labelledby=${'aud-scout-' + pr.id}>
      <div className="aud-scout-top"><${Chip} agentId=${pr.agentId} />
        ${pr.risk ? h`<${Pill} tone=${pr.risk === 'low' ? 'good' : (pr.risk === 'high' ? 'crit' : 'warn')}>${pr.risk === 'low' ? 'Low risk' : pr.risk === 'high' ? 'High risk' : 'Medium risk'}<//>` : null}

      </div>
      <h3 className="aud-h3" id=${'aud-scout-' + pr.id}>${(s && s.name) || pr.title}</h3>
      ${includes ? h`<p className="aud-muted aud-small">Also adds it to a campaign.</p>` : null}
      ${pr.rationale ? h`<p className="aud-scout-why">${pr.rationale}</p>` : null}
      ${evidence.length ? h`<dl className="aud-evidence">${evidence.slice(0, 4).map(function (e, i) {
        return h`<div key=${i + '-' + e.label}><dt>${e.label}</dt><dd className="num">${String(e.value)}</dd></div>`;
      })}</dl>` : null}
      ${plain ? h`<p className="aud-muted aud-small">${plain}</p>` : null}
      <div className="aud-scout-actions">
        <${Btn} kind="primary" size="sm" id=${'aud-scout-' + pr.id + '-create'} onClick=${approve}>${includes ? 'Approve' : 'Create segment'}<//>
        <${Btn} kind="ghost" size="sm" id=${'aud-scout-' + pr.id + '-dismiss'} onClick=${dismiss}>Dismiss<//>
        ${s ? h`<${Btn} kind="ghost" size="sm" id=${'aud-scout-' + pr.id + '-edit'} onClick=${edit}>Edit in builder<//>` : null}
        ${PC ? h`<button type="button" className="aud-link" aria-expanded=${more ? 'true' : 'false'} onClick=${function () { setMore(!more); }}>${more ? 'Hide details' : 'Details'}</button>` : null}
      </div>
      ${alt ? h`<p className="aud-muted aud-small">${'A similar suggestion uses a different cutoff. '}<button type="button" className="aud-link" onClick=${alt.onClick}>${'See ' + alt.label}</button></p>` : null}
      ${err ? h`<p className="aud-msg aud-msg-crit" role="alert">${err}</p>` : null}
      ${more && PC ? h`<div className="aud-scout-more"><${PC} id=${pr.id} flat=${true} /></div>` : null}
    </article>`;
  }

  function ScoutPanel(p) {
    var React = R();
    var proposals = useSel(function (w) { return w.proposals; });
    var status = useSel(function (w) { var a = w.agents && w.agents.byId.scout; return a ? a.status + '|' + a.autonomy : ''; });
    var list = proposals ? (proposals.open || []).map(function (id) { return proposals.byId[id]; })
      .filter(function (x) { return x && x.agentId === 'scout' && x.status === 'pending'; }) : [];
    var ps = React.useState({}), pick = ps[0], setPick = ps[1];
    // Near-duplicates (same name before the first comma) collapse into one card with a link to the other version.
    var groups = [], byKey = {};
    list.forEach(function (pr) {
      var sg = segAction(pr);
      var k = String((sg && sg.name) || pr.title || pr.id).split(',')[0].trim().toLowerCase();
      if (!byKey[k]) { byKey[k] = { key: k, items: [] }; groups.push(byKey[k]); }
      byKey[k].items.push(pr);
    });
    var parts = (status || '').split('|');
    var note = parts[0] === 'paused' ? 'Segment Scout is paused.' : parts[1] === 'off' ? 'Segment Scout is off.' :
      parts[1] === 'autopilot' ? 'Segment Scout is on Autopilot: low-risk segments are created for you and show up in the table with its badge.' :
      'Segment Scout looks for high-response pockets every two days and queues them here.';
    return h`<section className="aud-scout" aria-labelledby="aud-scout-title">
      <div className="aud-card-head">
        <h2 id="aud-scout-title" className="aud-h3">Suggested by Segment Scout</h2>
        <button type="button" className="aud-link" onClick=${function () { go('agents', { tab: 'roster', agentId: 'scout' }); }}>Agent settings</button>
      </div>
      ${groups.length ? h`<div className="aud-scout-grid">${groups.map(function (g) {
        var i = (pick[g.key] || 0) % g.items.length, pr = g.items[i];
        var other = g.items.length > 1 ? g.items[(i + 1) % g.items.length] : null;
        var os = other && segAction(other);
        var alt = other ? { label: (os && os.name) || other.title, onClick: function () { var n = {}; n[g.key] = i + 1; setPick(Object.assign({}, pick, n)); } } : null;
        return h`<${ScoutCard} key=${g.key} proposal=${pr} alt=${alt} onTab=${p.onTab} />`;
      })}</div>`
        : h`<p className="aud-muted">No suggestions waiting. ${note}</p>`}
    </section>`;
  }

  /* ---------------- Segments tab: table and detail ---------------- */
  function SimpleTable(p) {
    return h`<table className="aud-table">
      <thead><tr>${p.columns.map(function (c) { return h`<th key=${c.key} scope="col" className=${c.align === 'right' ? 'is-num' : ''}>${c.label}</th>`; })}</tr></thead>
      <tbody>${p.rows.map(function (r) {
        var k = p.rowKey(r);
        return h`<tr key=${k} className=${p.selectedKey === k ? 'is-selected' : ''}>
          ${p.columns.map(function (c, ci) {
            var v = c.render ? c.render(r) : (c.format ? c.format(r[c.key], r) : r[c.key]);
            if (ci === 0 && p.onRowClick) v = h`<button type="button" className="aud-link aud-row-btn" onClick=${function () { p.onRowClick(r); }}>${v}</button>`;
            return h`<td key=${c.key} className=${c.align === 'right' ? 'is-num num' : ''}>${v}</td>`;
          })}</tr>`;
      })}</tbody>
    </table>`;
  }

  function SegmentsTab(p) {
    var React = R();
    var rows = useSel(function (w) { return sel('segmentRows', w) || EMPTY; }) || EMPTY;
    var campaigns = useSel(function (w) { return w.campaigns; });
    var segments = useSel(function (w) { return w.segments; });
    var selectedId = MC.hooks.useUi(function (s) { return s.focus && s.focus.audiences ? s.focus.audiences.segmentId : null; });
    var confirmSt = React.useState(false), confirm = confirmSt[0], setConfirm = confirmSt[1];
    var msgSt = React.useState(null), msg = msgSt[0], setMsg = msgSt[1];
    var Table = (MC.ui && MC.ui.DataTable) || SimpleTable;
    var Spark = chart('Sparkline');
    var IC = ui('InlineConfirm');
    function cname(id) { var c = campaigns && campaigns.byId[id]; return c ? c.name : id; }
    var columns = [
      { key: 'name', label: 'Name', render: function (r) { return r.name; } },
      { key: 'count', label: 'Size', align: 'right', sort: true, format: function (v) { return fmtNum(v); } },
      { key: 'change7', label: '7d change', align: 'right', format: function (v) { return fin(v) ? (v > 0 ? '+' : v < 0 ? MINUS : '') + fmtNum(Math.abs(v)) : DASH; } },
      { key: 'meanProp', label: 'Avg propensity', align: 'right', format: function (v) { return fmtPct(v, 1); } },
      { key: 'meanLtv', label: 'Predicted LTV', align: 'right', format: function (v) { return fmtMoney(v); } },
      { key: 'roas', label: 'Return', align: 'right', format: function (v) { return fmtRatio(v); } },
      { key: 'usedIn', label: 'Used in', render: function (r) { return r.usedIn && r.usedIn.length ? r.usedIn.map(cname).join(', ') : DASH; } },
      { key: 'author', label: 'Author', render: function (r) { return h`<${Chip} agentId=${r.author && r.author.indexOf('agent:') === 0 ? r.author.slice(6) : 'user'} />`; } }
    ];
    var s = selectedId && segments ? segments.byId[selectedId] : null;
    var row = s ? rows.filter(function (r) { return r.id === s.id; })[0] : null;
    function select(r) { setFocus({ segmentId: r.id }); setConfirm(false); setMsg(null); }
    function remove() {
      var r = dispatch('segment/remove', { id: s.id });
      setConfirm(false);
      if (!r.ok) { setMsg({ tone: 'crit', text: r.error || 'Couldn’t delete the segment.' }); return; }
      setMsg({ tone: 'good', text: 'Deleted “' + s.name + '”.' });
      setFocus({ segmentId: null });
    }
    return h`<div className="aud-segments">
      <section className="aud-card" aria-labelledby="aud-seg-title">
        <div className="aud-card-head">
          <h2 id="aud-seg-title" className="aud-h2">Segments <span className="aud-muted num">${fmtNum(rows.length)}</span></h2>
          <${Btn} kind="primary" size="sm" id="aud-seg-new" onClick=${function () {
            builderMemo = { rule: emptyRule(), name: '', editingId: null, text: '', parsed: null, prevRule: null };
            builderListeners.forEach(function (fn) { fn(); });
            p.onTab('builder');
          }}>New segment<//>
        </div>
        <div className="k-scroll-x aud-scroll">
          ${rows.length ? h`<${Table} columns=${columns} rows=${rows} rowKey=${function (r) { return r.id; }} selectedKey=${selectedId}
            onRowClick=${select} empty="No segments yet." />` : h`<p className="aud-empty">No segments yet. Describe an audience in the Builder to create your first one.</p>`}
        </div>
        ${msg && !s ? h`<${Msg} msg=${msg} />` : null}
      </section>
      ${s ? h`<section className="aud-card aud-seg-detail" aria-labelledby="aud-seg-detail-title">
        <div className="aud-card-head">
          <h2 id="aud-seg-detail-title" className="aud-h2">${s.name}</h2>
          <button type="button" className="aud-x" aria-label="Close segment details" onClick=${function () { setFocus({ segmentId: null }); }}>${TIMES}</button>
        </div>
        <${MadeBy} kind="segment" id=${s.id} />
        <p>${describeRule(s.rule) || 'Matches everyone.'}</p>
        <div className="aud-detail-stats">
          <div><span className="aud-stat-k">Size</span><span className="aud-stat-v num">${fmtNum(s.count)}</span></div>
          <div><span className="aud-stat-k">Counted</span><span className="aud-stat-v">${fmtDayShort(s.countDay)}</span></div>
          <div><span className="aud-stat-k">Created by</span><span className="aud-stat-v"><${Chip} agentId=${s.author && s.author.indexOf('agent:') === 0 ? s.author.slice(6) : 'user'} /></span></div>
          ${row ? h`<div><span className="aud-stat-k">Used in</span><span className="aud-stat-v">${row.usedIn.length ? row.usedIn.map(cname).join(', ') : 'Not used yet'}</span></div>` : null}
        </div>
        ${Spark && s.countHist && s.countHist.length > 1 ? h`<div className="aud-spark"><span className="aud-stat-k">Daily size, last ${s.countHist.length} days</span>
          <${Spark} values=${s.countHist} width=${160} height=${32} ariaLabel=${'Daily size of ' + s.name} /></div>` : null}
        <div className="aud-detail-actions">
          <${Btn} kind="primary" size="sm" id="aud-seg-edit" onClick=${function () { MC.audiences.openInBuilder(s.id); p.onTab('builder'); }}>Edit in builder<//>
          <${Btn} kind="secondary" size="sm" id="aud-seg-profiles" onClick=${function () { p.onProfilesFor(s.id); }}>View profiles<//>
          <${Btn} kind="secondary" size="sm" id="aud-seg-overlap" onClick=${function () { p.onOverlapWith(s.id); }}>Compare overlap<//>
          ${confirm ? h`<${IC} message=${'Delete “' + s.name + '”?'} confirmLabel="Delete" cancelLabel="Keep" tone="crit"
              onConfirm=${remove} onCancel=${function () { setConfirm(false); }} />`
            : h`<${Btn} kind="danger" size="sm" id="aud-seg-delete" onClick=${function () { setConfirm(true); }}>Delete segment<//>`}
        </div>
        <${Msg} msg=${msg} />
      </section>` : null}
      <${ScoutPanel} onTab=${p.onTab} />
    </div>`;
  }

  /* ---------------- Profiles tab ---------------- */
  var PAGE = 50;
  var CONSENT_KEYS = [['canEmail', 'E', 'Email'], ['canSms', 'S', 'SMS'], ['canPush', 'P', 'Push'], ['canAds', 'A', 'Ads']];

  function ConsentIcons(p) {
    var r = p.row;
    return h`<span className="aud-consent" aria-label=${'Consent: ' + CONSENT_KEYS.map(function (k) { return k[2] + (r[k[0]] ? ' yes' : ' no'); }).join(', ')}>
      ${CONSENT_KEYS.map(function (k) { return h`<span key=${k[0]} className=${'aud-consent-dot' + (r[k[0]] ? ' is-on' : '')} aria-hidden="true">${k[1]}</span>`; })}
    </span>`;
  }

  function ProfilesTab(p) {
    var React = R();
    var qSt = React.useState(''), q = qSt[0], setQ = qSt[1];
    var pageSt = React.useState(0), page = pageSt[0], setPage = pageSt[1];
    var dq = MC.hooks.useDebounced(q, 150);
    var segCounts = useSel(function (w) { return w.rev ? w.rev.segCounts : 0; });
    useSel(function (w) { return w.rev ? w.rev.profiles : 0; });
    var segments = useSel(function (w) { return w.segments; });
    var w = world();
    var matches = React.useMemo(function () {
      var W = world(), P = W && W.profiles;
      if (!P) return EMPTY;
      var bits = p.segFilter ? membersOf(W, p.segFilter) : null;
      var needle = dq.trim().toLowerCase(), out = [];
      for (var i = 0; i < P.n; i++) {
        if (bits && !bits[i]) continue;
        if (needle && P.name[i].toLowerCase().indexOf(needle) < 0 && P.id[i].toLowerCase().indexOf(needle) < 0) continue;
        out.push(i);
      }
      return out;
    }, [dq, p.segFilter, segCounts]);
    React.useEffect(function () { setPage(0); }, [dq, p.segFilter]);
    var pages = Math.max(1, Math.ceil(matches.length / PAGE));
    var pg = Math.min(page, pages - 1);
    var slice = matches.slice(pg * PAGE, pg * PAGE + PAGE);
    var segList = segments ? segments.order.map(function (id) { return segments.byId[id]; }).filter(Boolean) : EMPTY;
    var filterMissing = p.segFilter && segments && !segments.byId[p.segFilter];
    return h`<section className="aud-card aud-profiles" aria-labelledby="aud-prof-title">
      <div className="aud-card-head"><h2 id="aud-prof-title" className="aud-h2">Profiles</h2></div>
      <div className="aud-toolbar">
        <div className="aud-field">
          <label className="aud-label" htmlFor="aud-prof-search">Search by name or id</label>
          <input id="aud-prof-search" className="aud-input" type="search" value=${q} placeholder="Maya R. or P-00123"
            onChange=${function (e) { setQ(e.target.value); }} />
        </div>
        <div className="aud-field">
          <label className="aud-label" htmlFor="aud-prof-segment">Segment</label>
          <select id="aud-prof-segment" className="aud-input" value=${p.segFilter || ''} onChange=${function (e) { p.setSegFilter(e.target.value || null); }}>
            <option value="">All profiles</option>
            ${segList.map(function (s) { return h`<option key=${s.id} value=${s.id}>${s.name}</option>`; })}
          </select>
        </div>
      </div>
      ${filterMissing ? h`<p className="aud-msg aud-msg-warn">That segment was removed, so every profile is shown.</p>` : null}
      ${!w ? null : !matches.length ? h`<p className="aud-empty">No profiles match${dq ? ' “' + dq + '”' : ''}${p.segFilter ? ' in this segment' : ''}.</p>` : h`
        <div className="k-scroll-x aud-scroll">
          <table className="aud-table aud-prof-table">
            <thead><tr>
              <th scope="col">Name</th><th scope="col">Location</th><th scope="col">Tier</th><th scope="col" className="is-num">Last order</th>
              <th scope="col" className="is-num">Propensity</th><th scope="col" className="is-num">Churn</th><th scope="col" className="is-num">LTV</th>
              <th scope="col">Best channel</th><th scope="col">Best hour</th><th scope="col">Consent</th>
            </tr></thead>
            <tbody>${slice.map(function (i) {
              var r = sel('profileRow', w, i);
              if (!r) return null;
              return h`<tr key=${r.id} className=${p.openIdx === i ? 'is-selected' : ''}>
                <td><button type="button" className="aud-link aud-row-btn" onClick=${function () { p.onOpen(i); }}>${r.name}</button>
                  <span className="aud-mono aud-small">${r.id}</span></td>
                <td>${r.stateLabel || r.state || DASH}${r.regionLabel ? h`<span className="aud-muted aud-small"> ${DOT} ${r.regionLabel}</span>` : null}</td>
                <td>${r.tierLabel || r.tier || DASH}</td>
                <td className="is-num num">${fin(r.lastOrderDays) ? r.lastOrderDays + 'd ago' : 'Never'}</td>
                <td className="is-num num">${fmtPct(r.prop, 0)}</td>
                <td className="is-num num">${fmtPct(r.churn, 0)}</td>
                <td className="is-num num">${fmtMoney(r.ltv)}</td>
                <td>${BESTCH_LABELS[r.bestCh] || r.bestCh}</td>
                <td className="num">${fmtHour(r.bestHr)}</td>
                <td><${ConsentIcons} row=${r} /></td>
              </tr>`;
            })}</tbody>
          </table>
        </div>
        <div className="aud-pager">
          <span className="num aud-muted">${fmtNum(pg * PAGE + 1)}${DASH}${fmtNum(pg * PAGE + slice.length)} of ${fmtNum(matches.length)}</span>
          <${Btn} kind="secondary" size="sm" id="aud-prof-prev" disabled=${pg === 0} onClick=${function () { setPage(pg - 1); }}>Previous<//>
          <${Btn} kind="secondary" size="sm" id="aud-prof-next" disabled=${pg >= pages - 1} onClick=${function () { setPage(pg + 1); }}>Next<//>
        </div>`}
    </section>`;
  }

  /* ---------------- Profile drawer ---------------- */
  var PRED = [['prop', 'Propensity to buy (30 days)', 'pct'], ['churn', 'Churn risk', 'pct'], ['ltv', 'Predicted LTV (12 months)', 'money']];

  function Why(p) {
    var React = R();
    var st = React.useState(false), open = st[0], setOpen = st[1];
    var rows = React.useMemo(function () {
      if (!open || !MC.models || !has(MC.models, 'explain')) return null;
      try { return MC.models.explain(world(), p.idx, p.which) || []; } catch (e) { return []; }
    }, [open, p.idx, p.which, p.rev]);
    var max = 0;
    (rows || []).forEach(function (r) { if (Math.abs(r.delta) > max) max = Math.abs(r.delta); });
    var bid = 'aud-why-' + p.which;
    return h`<div className="aud-why">
      <button type="button" className="aud-link" aria-expanded=${open ? 'true' : 'false'} aria-controls=${bid} onClick=${function () { setOpen(!open); }}>Why</button>
      ${open ? h`<div id=${bid} className="aud-why-body">
        ${!rows ? h`<p className="aud-muted aud-small">Explanations load with the prediction models.</p>`
          : !rows.length ? h`<p className="aud-muted aud-small">No single factor stands out.</p>`
          : h`<ul className="aud-contrib">${rows.map(function (r, i) {
            var pos = r.delta >= 0;
            return h`<li key=${i + '-' + r.label}>
              <span className="aud-contrib-l">${r.label}</span>
              <span className="aud-contrib-bar" aria-hidden="true"><span className=${pos ? 'is-pos' : 'is-neg'} style=${{ width: (max ? 100 * Math.abs(r.delta) / max : 0) + '%' }}></span></span>
              <span className="aud-contrib-v num">${(pos ? '+' : MINUS) + Math.abs(r.delta).toFixed(2)}</span></li>`;
          })}</ul>`}
      </div>` : null}
    </div>`;
  }

  function fatigueLevel(F, s7) {
    if (F >= 3 || s7 >= 5) return { label: 'High', tone: 'crit' };
    if (F >= 1.5 || s7 >= 3) return { label: 'Medium', tone: 'warn' };
    return { label: 'Low', tone: 'good' };
  }

  function ProfileDetail(p) {
    var React = R();
    var rev = useSel(function (w) { return w.rev ? w.rev.profiles : 0; });
    var tick = useSel(function (w) { return w.meta.tick; });
    var segments = useSel(function (w) { return w.segments; });
    var segCounts = useSel(function (w) { return w.rev ? w.rev.segCounts : 0; });
    var msgSt = React.useState(null), msg = msgSt[0], setMsg = msgSt[1];
    var w = world(), i = p.idx;
    var r = w ? sel('profileRow', w, i) : null;
    var memberships = React.useMemo(function () {
      var W = world();
      if (!W || !segments) return EMPTY;
      return segments.order.filter(function (id) { var b = membersOf(W, id); return b && b[i]; }).map(function (id) { return segments.byId[id]; });
    }, [i, segments, segCounts]);
    if (!r) return h`<p className="aud-muted">This profile isn’t available.</p>`;
    var P = w.profiles;
    var touches = [];
    for (var s = 0; s < 8; s++) {
      var k = i * 8 + s, c = P.touchC ? P.touchC[k] : -1;
      if (c < 0) continue;
      var cid = w.campaigns.all ? w.campaigns.all[c] : null, camp = cid ? w.campaigns.byId[cid] : null;
      touches.push({ key: 't' + s, t: P.touchT[k], ch: MC.CH.ALL[P.touchCh[k]], name: camp ? camp.name : 'A past campaign' });
    }
    touches.sort(function (a, b) { return b.t - a.t || (a.key < b.key ? -1 : 1); });
    var fl = fatigueLevel(r.fatigue, r.sent7);
    var sups = MC.CH.OWNED.filter(function (ch) { return r.suppressedUntil && r.suppressedUntil[ch] > tick; });
    function release(ch) {
      var res = dispatch('profiles/release', { channel: ch, idx: [i] });
      setMsg(res.ok ? { tone: 'good', text: r.name + ' can receive ' + chLabel(ch) + ' again.' } : { tone: 'crit', text: res.error || 'Couldn’t release.' });
    }
    return h`<div className="aud-profile">
      <div className="aud-profile-head">
        <span className="aud-mono">${r.id}</span>
      </div>
      <p className="aud-muted">${[r.stateLabel || r.state, r.regionLabel, r.tierLabel ? r.tierLabel + ' tier' : null, fin(r.age) ? 'age ' + r.age : null].filter(Boolean).join(' ' + DOT + ' ')}</p>
      <dl className="aud-facts">
        <div><dt>Orders</dt><dd className="num">${fmtNum(r.orders)}</dd></div>
        <div><dt>Spend</dt><dd className="num">${fmtMoney(r.spend)}</dd></div>
        <div><dt>Last order</dt><dd className="num">${fin(r.lastOrderDays) ? r.lastOrderDays + ' days ago' : 'Never'}</dd></div>
        <div><dt>Top category</dt><dd>${r.topCategoryLabel || r.topCategory || DASH}</dd></div>
      </dl>
      <h3 className="aud-h3">Predictions</h3>
      <ul className="aud-preds">
        ${PRED.map(function (pd) {
          var v = r[pd[0]];
          return h`<li key=${pd[0]}><div className="aud-pred-row"><span>${pd[1]}</span>
            <strong className="num">${pd[2] === 'pct' ? fmtPct(v, 0) : fmtMoney(v)}</strong></div>
            <${Why} idx=${i} which=${pd[0]} rev=${rev} /></li>`;
        })}
        <li><div className="aud-pred-row"><span>Best channel</span><strong>${BESTCH_LABELS[r.bestCh] || r.bestCh}</strong></div></li>
        <li><div className="aud-pred-row"><span>Best send hour</span><strong className="num">${fmtHour(r.bestHr)}</strong></div></li>
      </ul>
      <h3 className="aud-h3">Consent</h3>
      <p className="aud-consent-line">${CONSENT_KEYS.map(function (k, j) {
        return h`<span key=${k[0]} className=${r[k[0]] ? '' : 'aud-muted'}>${(j ? ' ' + DOT + ' ' : '') + k[2] + (r[k[0]] ? ' yes' : ' no')}</span>`;
      })}</p>
      <h3 className="aud-h3">Fatigue</h3>
      <p><${Pill} tone=${fl.tone}>${fl.label}<//> <span className="num">${DASH} ${plural(r.sent7, 'message', 'messages')} in 7 days</span></p>
      <div className="aud-meter" role="img" aria-label=${'Fatigue score ' + r.fatigue.toFixed(1)}><span className=${'is-' + fl.tone} style=${{ width: Math.min(100, (r.fatigue / 5) * 100) + '%' }}></span></div>
      <h3 className="aud-h3">Recent touches</h3>
      ${touches.length ? h`<ol className="aud-timeline">${touches.map(function (t) {
        return h`<li key=${t.key}><span className="aud-mono aud-small">${fmtStamp(t.t)}</span> <span>${chLabel(t.ch)} ${DOT} ${t.name}</span></li>`;
      })}</ol>` : h`<p className="aud-muted">No campaign touches yet.</p>`}
      <h3 className="aud-h3">Segments</h3>
      ${memberships.length ? h`<p>${memberships.map(function (s2) { return s2.name; }).join(', ')}</p>`
        : h`<p className="aud-muted">Not in any saved segment.</p>`}
      <h3 className="aud-h3">Suppressions</h3>
      ${sups.length ? h`<ul className="aud-sups">${sups.map(function (ch) {
        return h`<li key=${ch}><span>Rested from ${chLabel(ch)} until ${fmtStamp(r.suppressedUntil[ch])}</span>
          <${Btn} kind="secondary" size="sm" id=${'aud-prof-release-' + ch} onClick=${function () { release(ch); }}>Release<//></li>`;
      })}</ul>` : h`<p className="aud-muted">Not rested from any channel.</p>`}
      <${Msg} msg=${msg} />
    </div>`;
  }

  /* ---------------- Overlap tab ---------------- */
  var MAX_OVERLAP = 8;

  function OverlapTab(p) {
    var React = R();
    var segments = useSel(function (w) { return w.segments; });
    var segCounts = useSel(function (w) { return w.rev ? w.rev.segCounts : 0; });
    var cellSt = React.useState(null), cell = cellSt[0], setCell = cellSt[1];
    var Heat = chart('Heatmap');
    var chosen = (p.chosen || EMPTY).filter(function (id) { return segments && segments.byId[id]; });
    var key = chosen.join('|');
    var data = React.useMemo(function () {
      var W = world();
      if (chosen.length < 2 || !W || !has(seg(), 'overlap')) return null;
      try { return seg().overlap(W, chosen); } catch (e) { return { error: String((e && e.message) || e) }; }
    }, [key, segCounts]);
    var names = chosen.map(function (id) { return segments.byId[id].name; });
    var pct = null;
    if (data && data.counts) {
      pct = data.counts.map(function (row, ri) {
        var base = row[ri] || 0;
        return row.map(function (v) { return base ? v / base : 0; });
      });
    }
    function toggle(id) {
      var next = chosen.indexOf(id) >= 0 ? chosen.filter(function (x) { return x !== id; }) : chosen.concat([id]);
      if (next.length > MAX_OVERLAP) return;
      p.setChosen(next); setCell(null);
    }
    function caption(ri, ci) {
      if (!data || !data.counts) return '';
      var n = data.counts[ri][ci], base = data.counts[ri][ri];
      return fmtNum(n) + ' of ' + fmtNum(base) + ' ' + names[ri] + ' are also in ' + names[ci] + ' (' + fmtPct(base ? n / base : 0) + ')';
    }
    var list = segments ? segments.order.map(function (id) { return segments.byId[id]; }).filter(Boolean) : EMPTY;
    return h`<div className="aud-overlap-grid">
      <fieldset className="aud-card aud-overlap-pick">
        <legend className="aud-h2">Segments to compare</legend>
        <p className="aud-muted aud-small">Pick up to ${MAX_OVERLAP}. ${chosen.length} selected.</p>
        <ul className="aud-checks">${list.map(function (s) {
          var on = chosen.indexOf(s.id) >= 0, id = 'aud-ov-' + s.id;
          return h`<li key=${s.id}><label htmlFor=${id} className="aud-check">
            <input type="checkbox" id=${id} checked=${on} disabled=${!on && chosen.length >= MAX_OVERLAP} onChange=${function () { toggle(s.id); }} />
            <span>${s.name}</span> <span className="aud-muted num">${fmtNum(s.count)}</span></label></li>`;
        })}</ul>
      </fieldset>
      <section className="aud-card aud-overlap-main" aria-labelledby="aud-ov-title">
        <h2 id="aud-ov-title" className="aud-h2">Overlap</h2>
        ${chosen.length < 2 ? h`<p className="aud-empty">Pick two or more segments to compare.</p>`
          : !has(seg(), 'overlap') ? h`<p className="aud-muted">Overlap appears once the segment engine has loaded.</p>`
          : data && data.error ? h`<p className="aud-msg aud-msg-crit">Couldn’t compute overlap: ${data.error}</p>`
          : pct ? h`<div>
            <p className="aud-muted aud-small">Each row shows what share of that segment also belongs to each column’s segment.</p>
            <div className="k-scroll-x aud-scroll">
              ${Heat ? h`<${Heat} rows=${chosen.map(function (id, i) { return { key: id, label: names[i] }; })}
                cols=${chosen.map(function (id, i) { return { key: id, label: names[i] }; })} values=${pct} format="pct" min=${0} max=${1}
                rowLabel="Segment" label="Row-normalized segment overlap"
                onCell=${function (ri, ci) { setCell({ ri: ri, ci: ci, a: chosen[ri], b: chosen[ci] }); }} />` : null}
            </div>
            <p className="aud-overlap-caption num">${cell && chosen[cell.ri] === cell.a && chosen[cell.ci] === cell.b ? caption(cell.ri, cell.ci) : 'Select a cell to read it in words.'}</p>
          </div>` : null}
      </section>
    </div>`;
  }

  /* ---------------- View ---------------- */
  var TABS = [{ id: 'segments', label: 'Segments' }, { id: 'builder', label: 'Builder' }, { id: 'profiles', label: 'Profiles' }, { id: 'overlap', label: 'Overlap' }];
  var TAB_IDS = TABS.map(function (t) { return t.id; });
  // Per-session conveniences that outlive a route change (never written to the world).
  var viewMemo = { segFilter: null, overlap: ['s-pnw', 's-lapsed', 's-highltv'] };

  function AudiencesView() {
    var React = R();
    var ready = useSel(function (w) { return !!(w && w.profiles); });
    var focus = MC.hooks.useUi(function (s) { return s.focus && s.focus.audiences; }) || {};
    var segCount = useSel(function (w) { return w.segments ? w.segments.order.length : 0; });
    var pending = useSel(function (w) {
      var pr = w.proposals; if (!pr) return 0;
      var seen = {}, n = 0;
      (pr.open || EMPTY).forEach(function (id) {
        var x = pr.byId[id];
        if (!x || x.agentId !== 'scout' || x.status !== 'pending') return;
        var sg = segAction(x), k = String((sg && sg.name) || x.title || id).split(',')[0].trim().toLowerCase();
        if (!seen[k]) { seen[k] = 1; n++; }
      });
      return n;
    });
    var tab = TAB_IDS.indexOf(focus.tab) >= 0 ? focus.tab : 'segments';
    var sfSt = React.useState(viewMemo.segFilter), segFilter = sfSt[0], setSegFilterSt = sfSt[1];
    var ovSt = React.useState(viewMemo.overlap), overlap = ovSt[0], setOverlapSt = ovSt[1];
    var Tabs = ui('Tabs');
    var Drawer = ui('Drawer');
    var openIdx = fin(focus.profileIdx) ? focus.profileIdx : null;
    var profileName = useSel(function (w) { return openIdx !== null && w.profiles && openIdx < w.profiles.n ? w.profiles.name[openIdx] : null; });

    function setTab(t) { setFocus({ tab: t }); }
    // Mode changes triggered from inside the view move focus to the page heading.
    function jumpTab(t) {
      setTab(t);
      setTimeout(function () { var el = document.getElementById('page-title'); if (el && el.focus) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } } }, 0);
    }
    function setSegFilter(id) { viewMemo.segFilter = id; setSegFilterSt(id); }
    function setOverlap(ids) { viewMemo.overlap = ids; setOverlapSt(ids); }
    function openProfile(i) { setFocus({ profileIdx: i }); }
    function closeProfile() { setFocus({ profileIdx: null }); }

    var tabs = TABS.map(function (t) {
      if (t.id === 'segments') return Object.assign({}, t, { count: segCount || undefined });
      return t;
    });
    var body = null;
    if (!ready) body = h`<p className="aud-empty">Loading Fernway Outfitters customers${ELL}</p>`;
    else if (tab === 'builder') body = h`<${Builder} onOpenProfile=${openProfile} />`;
    else if (tab === 'profiles') body = h`<${ProfilesTab} segFilter=${segFilter} setSegFilter=${setSegFilter} openIdx=${openIdx} onOpen=${openProfile} />`;
    else if (tab === 'overlap') body = h`<${OverlapTab} chosen=${overlap} setChosen=${setOverlap} />`;
    else body = h`<${SegmentsTab} onTab=${jumpTab}
      onProfilesFor=${function (id) { setSegFilter(id); jumpTab('profiles'); }}
      onOverlapWith=${function (id) { var next = overlap.indexOf(id) >= 0 ? overlap : [id].concat(overlap).slice(0, MAX_OVERLAP); setOverlap(next); jumpTab('overlap'); }} />`;

    return h`<section className="v-audiences">
      <header className="aud-header">
        <div>
          <h1 id="page-title" tabIndex="-1" className="aud-title">Audiences <span className="mc-art-tag">made and maintained by your agents</span></h1>
          <p className="aud-sub">Segment Fernway Outfitters customers with rules, plain-language descriptions and predicted traits.</p>
        </div>
        ${pending ? h`<button type="button" className="aud-scout-flag" onClick=${function () { jumpTab('segments'); }}>
          ${plural(pending, 'segment suggestion', 'segment suggestions')} from Segment Scout</button>` : null}
      </header>
      <div className="aud-tabs-wrap">
        <${Tabs} id="aud-tabs" label="Audience sections" tabs=${tabs} value=${tab} onChange=${setTab} />
      </div>
      <div className="aud-panel" role="tabpanel" id=${'aud-panel-' + tab} aria-labelledby=${'aud-tabs-' + tab}>${body}</div>
      <${Drawer} open=${openIdx !== null && !!profileName} onClose=${closeProfile} title=${profileName || 'Profile'} width=${440}>
        ${openIdx !== null && profileName ? h`<${ProfileDetail} idx=${openIdx} />` : null}
      <//>
    </section>`;
  }

  MC.views.audiences = AudiencesView;
  MC.audiences.parts = { Builder: Builder, SegmentsTab: SegmentsTab, ProfilesTab: ProfilesTab, OverlapTab: OverlapTab, ProfileDetail: ProfileDetail };
  MC.audiences.describeRule = describeRule;
})();
