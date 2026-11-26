/* Marketing Cloud - agent UI components (attached to MC.ui):
   AgentChip, ProposalCard, GuardrailList, DiffTable, AllocationBar, ImpactBadge,
   TraceView, AgentPulse, AutonomyControl. Token colors only; store reads via
   narrow MC.hooks.useSelect selectors; drafts and menus live in local state. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.ui = MC.ui || {};

  var DASH = '–', ARROW = '→', DOT = '·';
  function html() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }

  var AGENT_NAMES = {
    optimizer: 'Variant Optimizer', sendtime: 'Send-Time Tuner', pacer: 'Budget Pacer', guard: 'Fatigue Guard',
    analyst: 'Insight Analyst', copy: 'Copy Drafter', scout: 'Segment Scout', planner: 'Campaign Planner'
  };
  var AGENT_ORDER = ['optimizer', 'sendtime', 'pacer', 'guard', 'analyst', 'copy', 'scout', 'planner'];
  var KIND_LABEL = {
    'traffic-shift': 'Traffic shift', 'pause-variant': 'Pause variant', 'send-time': 'Send time', 'adaptive-send': 'Adaptive send time',
    'budget-shift': 'Budget shift', 'fatigue-suppress': 'Fatigue rest', 'pause-channel': 'Pause channel', 'extend-campaign': 'Extend campaign',
    'new-variant': 'New variant', 'new-segment': 'New segment', 'retarget': 'Add audience', 'campaign-draft': 'Campaign draft'
  };
  var RISK = {
    low: { label: 'Low risk', bg: 'var(--good-soft)', fg: 'var(--good)' },
    medium: { label: 'Medium risk', bg: 'var(--warn-soft)', fg: 'var(--warn)' },
    high: { label: 'High risk', bg: 'var(--crit-soft)', fg: 'var(--crit)' }
  };

  function agentDef(id) {
    try { return MC.runtime && typeof MC.runtime.def === 'function' ? MC.runtime.def(id) : null; } catch (e) { return null; }
  }
  function agentName(id) {
    if (!id) return '';
    if (id === 'user') return 'You';
    var d = agentDef(id);
    return (d && d.name) || AGENT_NAMES[id] || String(id);
  }
  function agentFromOrigin(o) { return typeof o === 'string' && o.indexOf('agent:') === 0 ? o.slice(6) : null; }

  /* ---------- formatting ---------- */
  function commas(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function tryFmt(name, a, b) {
    try { if (MC.fmt && typeof MC.fmt[name] === 'function') { var r = MC.fmt[name](a, b); if (r != null) return String(r); } } catch (e) { /* local */ }
    return null;
  }
  function money(n) { if (!fin(n)) return DASH; return tryFmt('money', n) || ((n < 0 ? '-$' : '$') + commas(n)); }
  function num(n) { if (!fin(n)) return DASH; return tryFmt('num', n) || ((n < 0 ? '-' : '') + commas(n)); }
  function pct(p, dp) { if (!fin(p)) return DASH; return tryFmt('pct', p, dp) || ((p * 100).toFixed(dp == null ? 1 : dp).replace(/\.0$/, '') + '%'); }
  function signed(s, v) { return (v > 0 ? '+' : (v < 0 ? '−' : '')) + s.replace(/^[-−]/, ''); }
  function fmtUnit(v, unit, withSign) {
    if (!fin(v)) return DASH;
    var s;
    if (unit === '$') s = money(Math.abs(v));
    else if (unit === 'pp') {
      var pp = Math.abs(v) < 0.2 ? v * 100 : v;
      s = Math.abs(pp).toFixed(1) + ' pp';
    } else s = num(Math.abs(v));
    return withSign ? signed(s, v) : (v < 0 ? '−' + s : s);
  }
  function hh(t) {
    var r = tryFmt('time', t);
    if (r) return r;
    var h = ((t % 24) + 24) % 24;
    return (h < 10 ? '0' : '') + h + ':00';
  }
  function stamp(t) { return tryFmt('stamp', t) || ('Day ' + (Math.floor(t / 24) + 1) + ' ' + DOT + ' ' + hh(t)); }
  function rel(from, now) {
    if (!fin(from) || !fin(now)) return '';
    var r = tryFmt('rel', from, now);
    if (r) return r;
    var d = now - from, a = Math.abs(d);
    var s = a < 1 ? 'now' : (a < 48 ? a + 'h' : Math.round(a / 24) + 'd');
    if (s === 'now') return 'just now';
    return d >= 0 ? s + ' ago' : 'in ' + s;
  }

  /* ---------- store access ---------- */
  function safeSel(sel, w) { try { return w ? sel(w) : null; } catch (e) { return null; } }
  function useFallbackSelect(sel, eq) {
    var React = R();
    var cache = React.useRef({ has: false, v: null });
    var selRef = React.useRef(sel);
    selRef.current = sel;
    var subscribe = React.useCallback(function (cb) {
      return MC.store && typeof MC.store.subscribe === 'function' ? MC.store.subscribe(cb) : function () {};
    }, []);
    function get() {
      var w = MC.store && typeof MC.store.getState === 'function' ? MC.store.getState() : null;
      var v = safeSel(selRef.current, w), c = cache.current;
      if (c.has && (eq || Object.is)(c.v, v)) return c.v;
      c.has = true; c.v = v;
      return v;
    }
    return React.useSyncExternalStore(subscribe, get, get);
  }
  function useSel(sel, eq) {
    var f = MC.hooks && MC.hooks.useSelect;
    if (typeof f === 'function') return f(function (w) { return safeSel(sel, w); }, eq);
    return useFallbackSelect(sel, eq);
  }
  function dispatch(type, payload) {
    try {
      if (!MC.store || typeof MC.store.dispatch !== 'function') return { ok: false, error: 'The workspace is still starting up.' };
      return MC.store.dispatch({ type: type, payload: payload }) || { ok: false, error: 'No response.' };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }
  function go(route, patch) {
    try {
      if (MC.nav && typeof MC.nav.go === 'function') MC.nav.go(route, patch);
      else window.location.hash = '#' + route;
    } catch (e) { /* navigation is best effort */ }
  }

  /* ---------- tiny primitives ---------- */
  var BTN = {
    base: { font: 'inherit', fontSize: 13, fontWeight: 600, borderRadius: 6, padding: '6px 12px', minHeight: 36, cursor: 'pointer', border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6 },
    primary: { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)' },
    ghost: { background: 'transparent', borderColor: 'transparent', color: 'var(--accent)' }
  };
  function Btn(p) {
    var Kit = MC.ui.Button;
    if (typeof Kit === 'function' && !p.raw) {
      return html`<${Kit} kind=${p.kind || 'secondary'} size=${p.size || 'sm'} onClick=${p.onClick} disabled=${p.disabled}
        title=${p.title} type="button">${p.children}<//>`;
    }
    var st = Object.assign({}, BTN.base, p.kind === 'primary' ? BTN.primary : (p.kind === 'ghost' ? BTN.ghost : null),
      p.disabled ? { opacity: 0.55, cursor: 'not-allowed' } : null);
    return html`<button type="button" className=${'ag-btn ag-btn-' + (p.kind || 'secondary')} onClick=${p.onClick} disabled=${p.disabled}
      title=${p.title} aria-expanded=${p['aria-expanded']} style=${st}>${p.children}</button>`;
  }
  function Glyph(p) {
    var k = p.kind, s = p.size || 14;
    var col = k === 'pass' ? 'var(--good)' : (k === 'fail' ? 'var(--crit)' : (k === 'warn' ? 'var(--warn)' : 'var(--ink-3)'));
    var label = p.label || (k === 'pass' ? 'Passes' : (k === 'fail' ? 'Fails' : (k === 'warn' ? 'Warning' : 'Info')));
    var inner;
    if (k === 'pass') inner = html`<path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style=${{ stroke: col }} />`;
    else if (k === 'fail') inner = html`<path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" strokeWidth="1.8" strokeLinecap="round" style=${{ stroke: col }} />`;
    else if (k === 'warn') inner = html`<path d="M8 4.5v4.2M8 11.2v.3" fill="none" strokeWidth="1.8" strokeLinecap="round" style=${{ stroke: col }} />`;
    else inner = html`<path d="M8 7.2v4M8 4.8v.3" fill="none" strokeWidth="1.8" strokeLinecap="round" style=${{ stroke: col }} />`;
    return html`<svg role="img" aria-label=${label} width=${s} height=${s} viewBox="0 0 16 16" style=${{ flex: 'none', display: 'block' }}>
      <circle cx="8" cy="8" r="7" fill="none" strokeWidth="1.4" style=${{ stroke: col }} />${inner}
    </svg>`;
  }

  /* ================= AgentChip ================= */
  function AgentChip(p) {
    var id = p.agentId, md = p.size === 'md';
    var isUser = !id || id === 'user';
    var name = isUser ? 'You' : agentName(id);
    var style = {
      display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0,
      // Calm attribution (§11.3): a dot and the name in plain text, no filled pill.
      padding: 0, fontSize: md ? 13 : 12, fontWeight: 600, lineHeight: 1.5,
      background: 'none', color: isUser ? 'var(--ink-2)' : 'var(--agent)', whiteSpace: 'nowrap'
    };
    return html`<span className=${'ag-chip' + (isUser ? ' is-user' : '')} title=${p.title || name} style=${style}>
      <span aria-hidden="true" style=${{ width: md ? 8 : 7, height: md ? 8 : 7, borderRadius: '50%', flex: 'none', background: isUser ? 'var(--ink-3)' : 'var(--agent)' }}></span>
      ${p.showName === false ? html`<span className="sr-only" style=${{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>${name}</span>`
        : html`<span style=${{ overflow: 'hidden', textOverflow: 'ellipsis' }}>${name}</span>`}
    </span>`;
  }

  /* ================= GuardrailList ================= */
  function grStatus(it) {
    if (it.status === 'pass' || it.status === 'warn' || it.status === 'fail') return it.status;
    if (it.pass === true) return 'pass';
    if (it.pass === false) return it.blocking === false ? 'warn' : 'fail';
    return 'warn';
  }
  function GuardrailList(p) {
    var items = (p.items || []).filter(Boolean);
    if (!items.length) return html`<p className="ag-gr-empty" style=${{ margin: 0, color: 'var(--ink-3)', fontSize: 13 }}>No guardrails apply to this change.</p>`;
    var compact = !!p.compact;
    return html`<ul className=${'ag-guardrails' + (compact ? ' is-compact' : '')} aria-label=${p.ariaLabel || 'Guardrails'}
        style=${{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: compact ? 'row' : 'column', flexWrap: 'wrap', gap: compact ? '4px 14px' : 6, minWidth: 0 }}>
      ${items.map(function (it, i) {
        var st = grStatus(it);
        return html`<li key=${it.id || ('g' + i)} style=${{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, minWidth: 0 }}>
          <span style=${{ paddingTop: 2 }}><${Glyph} kind=${st} label=${st === 'pass' ? 'Passes' : (st === 'fail' ? 'Fails' : 'Warning')} /></span>
          <span style=${{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <span style=${{ color: 'var(--ink)', fontWeight: 500 }}>${it.label || it.id}</span>
            ${it.detail ? html`<span className="num" style=${{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>${compact ? ' (' + it.detail + ')' : ' ' + DASH + ' ' + it.detail}</span>` : null}
            ${it.locked ? html`<span style=${{ color: 'var(--ink-3)' }}> ${DOT} always enforced</span>` : null}
          </span>
        </li>`;
      })}
    </ul>`;
  }

  /* ================= DiffTable ================= */
  function cellText(v) {
    if (v == null || v === '') return DASH;
    if (typeof v === 'number') return fin(v) ? num(v) : DASH;
    if (typeof v === 'boolean') return v ? 'On' : 'Off';
    if (Array.isArray(v)) return v.map(cellText).join(', ');
    if (typeof v === 'object') return Object.keys(v).map(function (k) { return k + ' ' + cellText(v[k]); }).join(', ');
    return String(v);
  }
  function DiffTable(p) {
    var rows = (p.rows || []).filter(Boolean);
    if (!rows.length) return html`<p style=${{ margin: 0, color: 'var(--ink-3)', fontSize: 13 }}>No field changes.</p>`;
    var th = { textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--ink-3)', padding: '4px 8px 4px 0', borderBottom: '1px solid var(--line)' };
    var td = { padding: '5px 8px 5px 0', fontSize: 13, borderBottom: '1px solid var(--line)', verticalAlign: 'top', overflowWrap: 'anywhere' };
    return html`<div className="ag-diff k-scroll-x" style=${{ overflowX: 'auto', maxWidth: '100%' }}>
      <table className="num" style=${{ borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
        <thead><tr><th scope="col" style=${th}>Change</th><th scope="col" style=${th}>Before</th><th scope="col" aria-hidden="true" style=${th}></th><th scope="col" style=${th}>After</th></tr></thead>
        <tbody>${rows.map(function (r, i) {
          var b = cellText(r.before), a = cellText(r.after), changed = b !== a;
          return html`<tr key=${(r.label || '') + '|' + i}>
            <th scope="row" style=${Object.assign({}, td, { fontWeight: 500, color: 'var(--ink)', textAlign: 'left' })}>${r.label}</th>
            <td style=${Object.assign({}, td, { color: 'var(--ink-2)', textDecoration: changed && r.strike ? 'line-through' : 'none' })}>${b}</td>
            <td aria-hidden="true" style=${Object.assign({}, td, { color: 'var(--ink-3)' })}>${ARROW}</td>
            <td style=${Object.assign({}, td, { color: 'var(--ink)', fontWeight: changed ? 600 : 400 })}>${a}</td>
          </tr>`;
        })}</tbody>
      </table>
    </div>`;
  }

  /* ================= AllocationBar ================= */
  function shareOf(prev, key) {
    if (!prev) return null;
    if (Array.isArray(prev)) { for (var i = 0; i < prev.length; i++) if (prev[i] && prev[i].key === key) return prev[i].share; return 0; }
    return fin(prev[key]) ? prev[key] : 0;
  }
  function AllocationBar(p) {
    var parts = (p.parts || []).filter(function (x) { return x && x.key != null; });
    if (!parts.length) return null;
    var hasPrev = p.previous != null;
    function color(i) { return 'var(--chart-' + ((i % 6) + 1) + ')'; }
    function bar(getShare, h, label) {
      var tot = parts.reduce(function (s, x) { var v = getShare(x); return s + (fin(v) && v > 0 ? v : 0); }, 0) || 1;
      return html`<div role="img" aria-label=${label} style=${{ display: 'flex', gap: 2, height: h, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-2)', minWidth: 0 }}>
        ${parts.map(function (x, i) {
          var v = getShare(x), w = fin(v) && v > 0 ? v / tot * 100 : 0;
          return w > 0 ? html`<span key=${x.key} title=${(x.label || x.key) + ' ' + pct(v, 0)} style=${{ width: w + '%', background: color(i), minWidth: 2 }}></span>` : null;
        })}
      </div>`;
    }
    var after = parts.map(function (x) { return (x.label || x.key) + ' ' + pct(x.share, 0); }).join(', ');
    var before = hasPrev ? parts.map(function (x) { return (x.label || x.key) + ' ' + pct(shareOf(p.previous, x.key), 0); }).join(', ') : '';
    return html`<div className="ag-alloc" style=${{ display: 'grid', gap: 4, minWidth: 0 }}>
      ${hasPrev ? bar(function (x) { return shareOf(p.previous, x.key); }, 6, 'Before: ' + before) : null}
      ${bar(function (x) { return x.share; }, 12, (hasPrev ? 'After: ' : 'Allocation: ') + after)}
      <ul style=${{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
        ${parts.map(function (x, i) {
          var pv = hasPrev ? shareOf(p.previous, x.key) : null;
          return html`<li key=${x.key} style=${{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden="true" style=${{ width: 8, height: 8, borderRadius: 2, background: color(i) }}></span>
            <span style=${{ color: 'var(--ink)' }}>${x.label || x.key}</span>
            <span>${hasPrev ? pct(x.share, 0) + ' (was ' + pct(pv, 0) + ')' : pct(x.share, 0)}</span>
          </li>`;
        })}
      </ul>
    </div>`;
  }

  /* ================= ImpactBadge ================= */
  var METHOD = { did: 'vs control group', diff: 'before vs after', model: 'modelled', window: 'over the window' };
  function ImpactBadge(p) {
    var im = p.impact;
    if (!im || !fin(im.delta)) return html`<span className="ag-impact" style=${{ color: 'var(--ink-3)', fontSize: 13 }}>No measurable impact estimate</span>`;
    var unit = im.unit || '#';
    var main = fmtUnit(im.delta, unit, true) + ' ' + (im.metric || '');
    var horizon = fin(im.horizonDays) && im.horizonDays > 0 ? ' over ' + (Math.round(im.horizonDays * 10) / 10) + (im.horizonDays === 1 ? ' day' : ' days') : '';
    var range = fin(im.lo) && fin(im.hi) ? ' (' + fmtUnit(im.lo, unit, false) + DASH + fmtUnit(im.hi, unit, false) + ')' : '';
    var conf = fin(im.confidence) ? ' ' + DOT + ' confidence ' + Math.round(im.confidence <= 1 ? im.confidence * 100 : im.confidence) + '%' : '';
    var to = im.tradeoff && fin(im.tradeoff.delta) ? ' ' + DOT + ' ' + (im.tradeoff.delta < 0 ? 'forgoes ~' : 'adds ~') + fmtUnit(Math.abs(im.tradeoff.delta), im.tradeoff.unit || '$', false) + ' ' + (im.tradeoff.metric || '') : '';
    var r = p.realized;
    var realized = null;
    if (r && fin(r.delta)) {
      var good = r.delta >= 0;
      realized = html`<span className="ag-realized" style=${{ display: 'inline-block', marginLeft: 6, padding: '0 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: good ? 'var(--good-soft)' : 'var(--crit-soft)', color: good ? 'var(--good)' : 'var(--crit)' }}>
        ${'Realized ' + fmtUnit(r.delta, unit, true) + (r.method && METHOD[r.method] ? ' ' + METHOD[r.method] : '')}
      </span>`;
    } else if (p.measuring) {
      realized = html`<span style=${{ marginLeft: 6, fontSize: 12, color: 'var(--ink-3)' }}>${'Measuring' + '…' + (fin(p.hoursLeft) ? ' ' + p.hoursLeft + 'h left' : '')}</span>`;
    }
    return html`<span className="ag-impact num" style=${{ fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
      <strong style=${{ fontWeight: 600 }}>${main}</strong><span style=${{ color: 'var(--ink-2)' }}>${horizon + range + conf + to}</span>${realized}
    </span>`;
  }

  /* ================= ProposalCard ================= */
  function undoEq(a, b) {
    return (a ? a.ok : null) === (b ? b.ok : null) && (a ? a.reason : null) === (b ? b.reason : null);
  }
  function campaignIdOf(pr, variants) {
    var t = pr.target || {};
    if (t.kind === 'campaign') return t.id;
    if (t.kind === 'variant' && variants && variants.byId && variants.byId[t.id]) return variants.byId[t.id].campaignId;
    var acts = pr.actions || [];
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      if (a && a.payload && typeof a.type === 'string' && a.type.indexOf('campaign/') === 0 && a.type !== 'campaign/create' && a.payload.id) return a.payload.id;
      if (a && a.payload && a.type === 'profiles/suppress' && a.payload.campaignId) return a.payload.campaignId;
    }
    return null;
  }
  function allocView(pr, campaigns, variants) {
    var acts = pr.actions || [], act = null;
    for (var i = 0; i < acts.length; i++) if (acts[i] && acts[i].type === 'campaign/setAlloc') { act = acts[i]; break; }
    if (!act || !act.payload || !act.payload.alloc) return null;
    var pl = act.payload, prev = null;
    if (pr.status === 'pending') {
      var c = campaigns && campaigns.byId ? campaigns.byId[pl.id] : null;
      prev = c && c.alloc ? c.alloc[pl.channel] || null : null;
    } else if (Array.isArray(pr.inverse)) {
      for (var j = 0; j < pr.inverse.length; j++) {
        var inv = pr.inverse[j];
        if (inv && inv.type === 'campaign/setAlloc' && inv.payload && inv.payload.id === pl.id && inv.payload.channel === pl.channel) { prev = inv.payload.alloc; break; }
      }
    }
    var keys = Object.keys(pl.alloc);
    if (prev) Object.keys(prev).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    function vname(k) { var v = variants && variants.byId ? variants.byId[k] : null; return v ? (v.name || k) : k; }
    keys.sort(function (a, b) { var na = vname(a), nb = vname(b); return na < nb ? -1 : (na > nb ? 1 : (a < b ? -1 : (a > b ? 1 : 0))); });
    return {
      parts: keys.map(function (k) { return { key: k, label: vname(k), share: fin(pl.alloc[k]) ? pl.alloc[k] : 0 }; }),
      previous: prev
    };
  }
  var STATUS_NOTE = {
    rejected: 'Dismissed', expired: 'Expired without a decision', superseded: 'Replaced by a newer proposal for the same target',
    undone: 'Undone', stale: 'No longer applies: the campaign changed since this was proposed.'
  };
  var SEC = { display: 'grid', gridTemplateColumns: 'minmax(78px, 96px) minmax(0, 1fr)', gap: '4px 10px', alignItems: 'start' };
  var SEC_LABEL = { fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', paddingTop: 2, margin: 0 };

  function ProposalCard(p) {
    var React = R();
    var id = p.id;
    var pr = useSel(function (w) { return w.proposals && w.proposals.byId ? (w.proposals.byId[id] || null) : null; });
    var tick = useSel(function (w) { return w.meta ? w.meta.tick : 0; });
    var campaigns = useSel(function (w) { return w.campaigns || null; });
    var variants = useSel(function (w) { return w.variants || null; });
    var undoState = useSel(function (w) {
      var q = w.proposals && w.proposals.byId ? w.proposals.byId[id] : null;
      if (!q || (q.status !== 'applied' && q.status !== 'auto')) return null;
      return MC.runtime && typeof MC.runtime.undoCheck === 'function' ? MC.runtime.undoCheck(w, id) : { ok: true };
    }, undoEq);
    var ms = React.useState(false), menuOpen = ms[0], setMenu = ms[1];
    var es = React.useState(null), err = es[0], setErr = es[1];
    var titleId = 'proposal-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '-') + '-title';

    if (!pr) {
      return html`<article className="ag-card is-missing" style=${{ border: '1px dashed var(--line)', borderRadius: 10, padding: 12, color: 'var(--ink-3)', fontSize: 13 }}>
        This proposal is no longer available.</article>`;
    }
    var compact = !!p.compact, pending = pr.status === 'pending';
    var risk = RISK[pr.risk] || RISK.low;
    var cid = campaignIdOf(pr, variants);
    var camp = cid && campaigns && campaigns.byId ? campaigns.byId[cid] : null;
    var chan = pr.target && pr.target.channel;
    var chanLabel = chan ? ((MC.CH && MC.CH.LABEL && MC.CH.LABEL[chan]) || chan) : '';
    var alloc = compact ? null : allocView(pr, campaigns, variants);

    function act(type, payload, fallback) {
      setErr(null);
      var r = dispatch(type, payload);
      if (!r.ok) setErr(r.error || fallback);
      return r.ok;
    }
    function approve() { act('proposal/approve', { id: id }, "Couldn't approve this change."); }
    function reject(reason) { setMenu(false); act('proposal/reject', { id: id, reason: reason }, "Couldn't dismiss this proposal."); }
    function undo() { act('proposal/undo', { id: id }, "Couldn't undo this change."); }
    function openTarget() {
      if (camp) go('campaigns', { mode: 'detail', id: cid, tab: 'overview' });
      else if (pr.target && pr.target.kind === 'segment') go('audiences', { tab: 'segments', segmentId: pr.target.id });
      else if (pr.target && pr.target.kind === 'variant') go('content', { variantId: pr.target.id });
    }
    function onMenuKey(e) { if (e.key === 'Escape') { e.stopPropagation(); setMenu(false); } }

    var header = html`<div style=${{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', minWidth: 0 }}>
      <${AgentChip} agentId=${pr.agentId} />
      <span style=${{ fontSize: 12, color: 'var(--ink-2)' }}>${KIND_LABEL[pr.kind] || pr.kind}</span>
      <span style=${{ fontSize: 12, fontWeight: 600, color: risk.fg }}>${risk.label}</span>
      <span className="num" style=${{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>${rel(pr.tick, tick)}</span>
    </div>`;

    var reasonLine = pending && pr.reason && pr.reason !== 'Suggested'
      ? html`<div style=${{ fontSize: 12, color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}><${Glyph} kind="warn" size=${13} label="Needs review" />${pr.reason}</div>` : null;

    var measuring = (pr.status === 'applied' || pr.status === 'auto') && !pr.realized && fin(pr.appliedTick) && fin(pr.horizon) && pr.horizon > 0;
    var hoursLeft = measuring ? Math.max(0, pr.appliedTick + pr.horizon - tick) : null;
    var impact = html`<${ImpactBadge} impact=${pr.impact} realized=${pr.realized} measuring=${measuring} hoursLeft=${hoursLeft} />`;

    var footer;
    if (pending) {
      var expires = fin(pr.expiresTick) ? Math.max(0, pr.expiresTick - tick) : null;
      footer = html`<div style=${{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <${Btn} kind="primary" onClick=${approve}>Approve<//>
        <${Btn} raw=${true} kind="secondary" aria-expanded=${menuOpen ? 'true' : 'false'} onClick=${function () { setMenu(!menuOpen); }}>Dismiss <span aria-hidden="true">▾</span><//>
        ${!compact && (camp || (pr.target && (pr.target.kind === 'segment' || pr.target.kind === 'variant')))
          ? html`<${Btn} kind="ghost" onClick=${openTarget}>${camp ? 'Open campaign' : (pr.target.kind === 'segment' ? 'Open segment' : 'Open variant')}<//>` : null}
        ${expires != null ? html`<span className="num" style=${{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>${'Expires in ' + expires + 'h'}</span>` : null}
      </div>`;
    } else if (pr.status === 'applied' || pr.status === 'auto') {
      var canUndo = !undoState || undoState.ok;
      footer = html`<div style=${{ display: 'grid', gap: 6 }}>
        <div style=${{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <${Glyph} kind="pass" label="Applied" />
          <span style=${{ fontSize: 13, color: 'var(--ink-2)' }}>${(pr.status === 'auto' ? 'Applied automatically' : 'Approved and applied') + (fin(pr.appliedTick) ? ' at ' + hh(pr.appliedTick) : '')}</span>
          <span style=${{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
            <${Btn} kind="secondary" onClick=${undo} disabled=${!canUndo} title=${canUndo ? 'Restore the previous values' : (undoState && undoState.reason) || ''}>Undo<//>
            ${!compact && camp ? html`<${Btn} kind="ghost" onClick=${openTarget}>Open campaign<//>` : null}
          </span>
        </div>
        ${!canUndo && undoState && undoState.reason ? html`<p style=${{ margin: 0, fontSize: 12, color: 'var(--ink-2)' }}>${undoState.reason}</p>` : null}
      </div>`;
    } else {
      var note = pr.status === 'stale' && pr.reason ? pr.reason : (STATUS_NOTE[pr.status] || pr.status);
      footer = html`<p style=${{ margin: 0, fontSize: 13, color: 'var(--ink-2)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <${Glyph} kind=${pr.status === 'undone' || pr.status === 'rejected' ? 'info' : 'warn'} label=${pr.status} />
        <span>${note}${fin(pr.decidedTick) ? ' ' + DOT + ' ' + stamp(pr.decidedTick) : ''}</span>
      </p>`;
    }

    var menu = menuOpen && pending ? html`<div role="group" aria-label="Why dismiss this proposal?" onKeyDown=${onMenuKey}
        style=${{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <span style=${{ fontSize: 12, color: 'var(--ink-2)', alignSelf: 'center', marginRight: 4 }}>Reason:</span>
      <${Btn} raw=${true} kind="secondary" onClick=${function () { reject('not-now'); }}>Not now<//>
      <${Btn} raw=${true} kind="secondary" onClick=${function () { reject('wrong'); }}>Not a good idea<//>
      <${Btn} raw=${true} kind="secondary" onClick=${function () { reject('other'); }}>Other<//>
      <${Btn} raw=${true} kind="ghost" onClick=${function () { setMenu(false); }}>Cancel<//>
    </div>` : null;

    var targetLine = p.showTarget && (camp || chanLabel)
      ? html`<div style=${{ fontSize: 12, color: 'var(--ink-2)' }}>${'On ' + (camp ? camp.name : 'this audience') + (chanLabel ? ' ' + DOT + ' ' + chanLabel : '')}</div>` : null;

    var cardStyle = {
      display: 'grid', gap: 8, minWidth: 0, padding: compact ? '10px 12px' : '12px 14px', borderRadius: 10,
      background: 'var(--surface)', border: '1px solid var(--line)'
    };
    return html`<article className=${'ag-card ag-card-' + pr.status + (compact ? ' is-compact' : '')} aria-labelledby=${titleId} style=${cardStyle}>
      ${header}
      <h3 id=${titleId} style=${{ margin: 0, fontSize: compact ? 14 : 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>${pr.title}</h3>
      ${targetLine}
      ${reasonLine}
      ${compact ? html`<div>${impact}</div>` : html`<div style=${{ display: 'grid', gap: 8 }}>
        <div style=${SEC}><p style=${SEC_LABEL}>Why</p>
          <div style=${{ fontSize: 13, color: 'var(--ink)', minWidth: 0, overflowWrap: 'anywhere' }}>
            ${pr.rationale}
            ${pr.evidence && pr.evidence.length ? html`<ul style=${{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
              ${pr.evidence.map(function (ev, i) { return html`<li key=${(ev.label || '') + i}>${ev.label}: <span style=${{ color: 'var(--ink)' }}>${cellText(ev.value)}</span></li>`; })}
            </ul>` : null}
          </div>
        </div>
        <div style=${SEC}><p style=${SEC_LABEL}>Expected impact</p><div>${impact}</div></div>
        <div style=${SEC}><p style=${SEC_LABEL}>Guardrails</p><div style=${{ minWidth: 0 }}><${GuardrailList} items=${pr.guardrails} compact=${true} /></div></div>
        <div style=${SEC}><p style=${SEC_LABEL}>Changes</p>
          <div style=${{ display: 'grid', gap: 8, minWidth: 0 }}>
            ${alloc ? html`<${AllocationBar} parts=${alloc.parts} previous=${alloc.previous} />` : null}
            ${pr.diff && pr.diff.length ? html`<${DiffTable} rows=${pr.diff} />` : (alloc ? null : html`<span style=${{ fontSize: 13, color: 'var(--ink-3)' }}>No field changes listed.</span>`)}
          </div>
        </div>
      </div>`}
      ${footer}
      ${menu}
      ${err ? html`<p style=${{ margin: 0, fontSize: 12, color: 'var(--crit)' }}>${err}</p>` : null}
    </article>`;
  }

  /* ================= TraceView ================= */
  var MONO = { fontSize: 12, fontVariantNumeric: 'tabular-nums' };
  var H4 = { margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' };
  function rowCells(r) {
    if (Array.isArray(r)) return r;
    if (r && typeof r === 'object') {
      if ('label' in r) return [r.label, r.value];
      return Object.keys(r).map(function (k) { return r[k]; });
    }
    return [r];
  }
  function TraceRows(p) {
    var rows = (p.rows || []).slice(0, 40);
    if (!rows.length) return null;
    return html`<div className="k-scroll-x" style=${{ overflowX: 'auto', marginTop: 4 }}>
      <table className="num" style=${{ borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: '60%' }}>
        <tbody>${rows.map(function (r, i) {
          var cells = rowCells(r);
          return html`<tr key=${i}>${cells.map(function (c, j) {
            return html`<td key=${j} style=${{ padding: '2px 12px 2px 0', borderBottom: '1px solid var(--line)', color: j === 0 ? 'var(--ink-2)' : 'var(--ink)', textAlign: j === 0 ? 'left' : 'right', whiteSpace: 'nowrap' }}>${cellText(c)}</td>`;
          })}</tr>`;
        })}</tbody>
      </table>
    </div>`;
  }
  function payloadText(d) {
    var e = d.entity || {};
    var bits = [];
    if (e.id != null) bits.push('id:' + e.id);
    if (e.channel) bits.push('channel:' + e.channel);
    if (!bits.length && e.kind) bits.push(e.kind);
    return d.type + ' {' + bits.join(', ') + '}';
  }
  function TraceView(p) {
    var React = R();
    var cacheRef = React.useRef({ arr: null, id: null, v: null });
    var auditId = p.auditId;
    var entry = useSel(function (w) {
      var arr = w.audit && w.audit.entries;
      if (!arr || !auditId) return null;
      var c = cacheRef.current;
      if (c.arr === arr && c.id === auditId) return c.v;
      var found = null;
      for (var i = arr.length - 1; i >= 0; i--) if (arr[i] && arr[i].id === auditId) { found = arr[i]; break; }
      c.arr = arr; c.id = auditId; c.v = found;
      return found;
    });
    var byId = useSel(function (w) { return w.proposals ? w.proposals.byId : null; });
    if (!auditId) return html`<p style=${{ margin: 0, color: 'var(--ink-3)', fontSize: 13 }}>Pick a run to see how the agent decided.</p>`;
    if (!entry) return html`<p style=${{ margin: 0, color: 'var(--ink-3)', fontSize: 13 }}>This run is no longer in the audit log.</p>`;
    var trace = entry.trace || [];
    function stepsOf(k) { return trace.filter(function (s) { return s && s.step === k; }); }
    var obs = stepsOf('observe'), dec = stepsOf('decide'), grd = stepsOf('guardrails'), app = stepsOf('apply');
    var props = (entry.proposals || []).map(function (pid) { return byId ? byId[pid] : null; }).filter(Boolean);
    var disp = entry.dispatched || [];
    var sec = { padding: '10px 0', borderTop: '1px solid var(--line)' };
    function txt(s, i) {
      return html`<div key=${'t' + i} style=${{ fontSize: 13, color: 'var(--ink)', overflowWrap: 'anywhere' }}>${s.text}<${TraceRows} rows=${s.rows} /></div>`;
    }
    return html`<section className="ag-trace" aria-label=${'Run trace for ' + agentName(entry.agentId)} style=${{ minWidth: 0 }}>
      <div style=${{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
        <${AgentChip} agentId=${entry.agentId} size="md" />
        <span className="num" style=${{ fontSize: 13, color: 'var(--ink-2)' }}>${'Run at ' + stamp(entry.tick)}</span>
      </div>
      <div style=${sec}>
        <h4 style=${H4}>1 ${DOT} Observe</h4>
        ${obs.length ? obs.map(txt) : html`<div style=${{ fontSize: 13, color: 'var(--ink-3)' }}>No observations recorded.</div>`}
      </div>
      <div style=${sec}>
        <h4 style=${H4}>2 ${DOT} Decide</h4>
        ${dec.length ? html`<ol style=${{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>${dec.map(function (s, i) {
          return html`<li key=${'d' + i} style=${{ fontSize: 13, color: 'var(--ink)', overflowWrap: 'anywhere' }}>${s.text}<${TraceRows} rows=${s.rows} /></li>`;
        })}</ol>` : html`<div style=${{ fontSize: 13, color: 'var(--ink-3)' }}>Nothing crossed the materiality threshold this run.</div>`}
      </div>
      <div style=${sec}>
        <h4 style=${H4}>3 ${DOT} Guardrails</h4>
        ${grd.map(txt)}
        ${props.map(function (q) {
          return html`<div key=${q.id} style=${{ marginTop: 6 }}>
            <div style=${{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 2 }}>${q.title}</div>
            <${GuardrailList} items=${q.guardrails} compact=${true} />
          </div>`;
        })}
        ${!grd.length && !props.length ? html`<div style=${{ fontSize: 13, color: 'var(--ink-3)' }}>No proposals to check.</div>` : null}
      </div>
      <div style=${sec}>
        <h4 style=${H4}>4 ${DOT} Actions called</h4>
        ${app.map(txt)}
        ${disp.length ? html`<ul style=${{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>${disp.map(function (d, i) {
          return html`<li key=${'a' + i} style=${Object.assign({ color: 'var(--ink)', overflowWrap: 'anywhere' }, MONO)}>${payloadText(d)}</li>`;
        })}</ul>` : html`<div style=${{ fontSize: 13, color: 'var(--ink-3)' }}>${props.length ? 'No actions applied yet; proposals are waiting for review.' : 'No actions called.'}</div>`}
      </div>
    </section>`;
  }

  /* ================= AgentPulse ================= */
  function lastRunTick(r) { return fin(r.lastRun) ? r.lastRun : (r.lastRun && fin(r.lastRun.tick) ? r.lastRun.tick : (fin(r.lastRunTick) ? r.lastRunTick : null)); }
  function rosterOf(w) {
    if (MC.select && typeof MC.select.agentRoster === 'function') return MC.select.agentRoster(w);
    var ag = w.agents;
    if (!ag || !ag.order) return [];
    return ag.order.map(function (id) {
      var a = ag.byId[id] || {};
      return { id: id, name: agentName(id), status: a.status, autonomy: a.autonomy, lastRun: a.lastRunTick, changes24h: 0, pending: 0 };
    });
  }
  function rosterEq(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i], y = b[i];
      if (x.id !== y.id || x.status !== y.status || x.autonomy !== y.autonomy || lastRunTick(x) !== lastRunTick(y) || x.changes24h !== y.changes24h) return false;
    }
    return true;
  }
  function stateOf(r) {
    if (r.autonomy === 'off' || r.status === 'off') return 'off';
    if (r.status === 'paused') return 'paused';
    return 'running';
  }
  function useReduced() {
    var f = MC.hooks && MC.hooks.useReducedMotion;
    if (typeof f === 'function') return f();
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function AgentPulse(p) {
    var roster = useSel(rosterOf, rosterEq) || [];
    var need = useSel(function (w) { return w.proposals && w.proposals.open ? w.proposals.open.length : 0; }) || 0;
    var tick = useSel(function (w) { return w.meta ? w.meta.tick : 0; }) || 0;
    var reduced = useReduced();
    var list = roster.length ? roster : AGENT_ORDER.map(function (id) { return { id: id, name: AGENT_NAMES[id], status: 'active', autonomy: 'suggest', lastRun: null }; });
    var working = list.filter(function (r) { return stateOf(r) === 'running'; }).length;
    var text = working ? working + (working === 1 ? ' agent' : ' agents') + ' working' : 'Agents paused';
    if (need > 0) text += ' ' + DOT + ' ' + need + ' need' + (need === 1 ? 's' : '') + ' you';
    function onClick() {
      if (typeof p.onClick === 'function') p.onClick();
      else go('agents', { tab: 'roster' });
    }
    return html`<button type="button" className=${'ag-pulse' + (p.compact ? ' is-compact' : '')} onClick=${onClick} aria-label=${text + '. Open agents.'}
        style=${{ font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', cursor: 'pointer', minWidth: 0 }}>
      <span aria-hidden="true" style=${{ display: 'inline-flex', gap: 4 }}>
        ${(p.dots ? list : []).map(function (r) {
          var st = stateOf(r), lr = lastRunTick(r), ranNow = st !== 'off' && lr != null && lr === tick && tick > 0;
          var dot = { width: 8, height: 8, borderRadius: '50%', boxSizing: 'border-box', display: 'inline-block' };
          if (st === 'off') Object.assign(dot, { background: 'var(--line-strong)' });
          else if (st === 'paused') Object.assign(dot, { background: 'transparent', border: '1.5px solid var(--agent)' });
          else Object.assign(dot, { background: 'var(--agent)', opacity: ranNow ? 1 : 0.5 });
          if (ranNow) Object.assign(dot, { opacity: 1, outline: '1.5px solid var(--agent)', outlineOffset: 2 });
          if (!reduced) dot.transition = 'opacity 300ms ease';
          var tip = (r.name || agentName(r.id)) + ' ' + DOT + ' ' + (st === 'off' ? 'off' : (st === 'paused' ? 'paused' : (lr != null ? 'ran ' + hh(lr) : 'waiting for first run'))) +
            (fin(r.changes24h) && r.changes24h > 0 ? ' ' + DOT + ' ' + r.changes24h + (r.changes24h === 1 ? ' change' : ' changes') : '');
          return html`<span key=${r.id} title=${tip} style=${dot}></span>`;
        })}
        ${p.dots ? null : html`<span style=${{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: working ? 'var(--agent)' : 'var(--line-strong)' }}></span>`}
      </span>
      ${p.compact ? (need > 0 ? html`<span className="num" style=${{ fontSize: 12, fontWeight: 600, color: 'var(--agent)' }}>${need}</span>` : null)
        : html`<span className="num" style=${{ fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>${text}</span>`}
    </button>`;
  }

  /* ================= AutonomyControl ================= */
  var AUTONOMY = [
    { value: 'off', label: 'Off', help: "Doesn't run." },
    { value: 'suggest', label: 'Suggest', help: 'Proposals wait in Approvals.' },
    { value: 'autopilot', label: 'Autopilot', help: 'Applies changes that pass every guardrail; anything else waits for you.' }
  ];
  function AutonomyControl(p) {
    var React = R();
    var agentId = p.agentId;
    var value = useSel(function (w) { var a = w.agents && w.agents.byId ? w.agents.byId[agentId] : null; return a ? a.autonomy : null; });
    var es = React.useState(null), err = es[0], setErr = es[1];
    var def = agentDef(agentId);
    var allowed = def && def.autonomy && Array.isArray(def.autonomy.allowed) ? def.autonomy.allowed : ['off', 'suggest', 'autopilot'];
    var opts = AUTONOMY.filter(function (o) { return allowed.indexOf(o.value) >= 0; });
    var id = p.id || ('agents-' + agentId + '-autonomy');
    var label = p.label || ('Autonomy for ' + agentName(agentId));
    function change(v) {
      if (v === value) return;
      setErr(null);
      var r = dispatch('agent/setAutonomy', { id: agentId, autonomy: v });
      if (!r.ok) setErr(r.error || "Couldn't change autonomy.");
    }
    var cur = AUTONOMY.filter(function (o) { return o.value === value; })[0];
    var Seg = MC.ui.Segmented;
    var control;
    if (typeof Seg === 'function') {
      control = html`<${Seg} id=${id} label=${label} options=${opts.map(function (o) { return { value: o.value, label: o.label }; })} value=${value} onChange=${change} size="sm" />`;
    } else {
      var idx = opts.map(function (o) { return o.value; }).indexOf(value);
      var onKey = function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0);
        if (!d) return;
        e.preventDefault();
        var n = opts[(Math.max(0, idx) + d + opts.length) % opts.length];
        change(n.value);
        var el = document.getElementById(id + '-' + n.value);
        if (el) el.focus();
      };
      control = html`<div id=${id} role="radiogroup" aria-label=${label} onKeyDown=${onKey}
          style=${{ display: 'inline-flex', border: '1px solid var(--line-strong)', borderRadius: 6, overflow: 'hidden' }}>
        ${opts.map(function (o, i) {
          var on = o.value === value;
          return html`<button key=${o.value} id=${id + '-' + o.value} type="button" role="radio" aria-checked=${on ? 'true' : 'false'} tabIndex=${on || (idx < 0 && i === 0) ? 0 : -1}
            onClick=${function () { change(o.value); }}
            style=${{ font: 'inherit', fontSize: 13, minHeight: 36, padding: '4px 12px', border: 'none', borderLeft: i ? '1px solid var(--line-strong)' : 'none', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--ink)', fontWeight: on ? 600 : 500 }}>${o.label}</button>`;
        })}
      </div>`;
    }
    return html`<div className="ag-autonomy" style=${{ display: 'grid', gap: 4, minWidth: 0 }}>
      ${control}
      ${p.showHelp !== false && cur ? html`<p style=${{ margin: 0, fontSize: 12, color: 'var(--ink-2)' }}>${cur.help}${allowed.indexOf('autopilot') < 0 ? ' Autopilot is not available for this agent.' : ''}</p>` : null}
      ${err ? html`<p style=${{ margin: 0, fontSize: 12, color: 'var(--crit)' }}>${err}</p>` : null}
    </div>`;
  }

  /* ---------- exports ---------- */
  MC.ui.AgentChip = AgentChip;
  MC.ui.ProposalCard = ProposalCard;
  MC.ui.GuardrailList = GuardrailList;
  MC.ui.DiffTable = DiffTable;
  MC.ui.AllocationBar = AllocationBar;
  MC.ui.ImpactBadge = ImpactBadge;
  MC.ui.TraceView = TraceView;
  MC.ui.AgentPulse = AgentPulse;
  MC.ui.AutonomyControl = AutonomyControl;
})();
