/* Kestrel Marketing Cloud - Analytics view (#analytics). MC.views.analytics.
   Performance over time with forecasts and bands, agent impact vs control, funnel, channels and
   variants, attribution, ROI-ranked audiences, anomalies, a what-if budget simulator on fitted
   response curves, and narrative insights. Reads only through MC.select.* and narrow selectors;
   every filter lives in uiStore.focus.analytics and every editor (sliders) in local state. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};

  var DASH = '—', MID = ' · ', EN = '–', ARROW = ' → ', ELL = '…', TIMES = '×';
  var Z80 = 1.2816;
  var assign = Object.assign;

  function html() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function hooks() { return MC.hooks || {}; }
  function sel() { return MC.select || {}; }
  function has(obj, name) { return !!(obj && typeof obj[name] === 'function'); }
  function kit(name) { var c = MC.ui && MC.ui[name]; return typeof c === 'function' ? c : null; }
  function sameItems(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  function selTick(w) { return w.meta.tick; }
  function selCampaigns(w) { return w.campaigns; }
  function selProposals(w) { return w.proposals; }

  /* ---------------- formatting ---------------- */
  function fmtCall(name, a, b) {
    try { if (MC.fmt && typeof MC.fmt[name] === 'function') return MC.fmt[name](a, b); } catch (e) { /* fall through */ }
    return null;
  }
  function money(n, opt) {
    if (!fin(n)) return DASH;
    var r = fmtCall('money', n, opt);
    if (r != null) return r;
    var a = Math.abs(Math.round(n)), s = String(a).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-$' : '$') + s;
  }
  function moneyC(n) { return money(n, { compact: Math.abs(n) >= 10000 }); }
  function moneySigned(n) { if (!fin(n)) return DASH; return (n > 0 ? '+' : (n < 0 ? '-' : '')) + moneyC(Math.abs(n)); }
  function num(n, opt) {
    if (!fin(n)) return DASH;
    var r = fmtCall('num', n, opt);
    return r != null ? r : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(p, dp) {
    if (!fin(p)) return DASH;
    var r = fmtCall('pct', p, dp == null ? 1 : dp);
    return r != null ? r : (p * 100).toFixed(dp == null ? 1 : dp) + '%';
  }
  function signedPct(r, dp) { if (!fin(r)) return DASH; return (r > 0 ? '+' : (r < 0 ? '-' : '')) + pct(Math.abs(r), dp == null ? 0 : dp); }
  function ratio(x) {
    if (!fin(x)) return DASH;
    var r = fmtCall('ratio', x);
    return r != null ? r : x.toFixed(1) + TIMES;
  }
  // Calendar labels come from MC.time's display mapping (§11.1); never ticks.
  function tm(name) { return MC.time && typeof MC.time[name] === 'function' ? MC.time[name] : null; }
  function dayShort(d) {
    if (!fin(d)) return DASH;
    var f = tm('dayLabel');
    if (f) return f(d, { style: 'short' });
    var r = fmtCall('dayShort', d);
    return r != null ? r : DASH;
  }
  function stamp(t) {
    if (!fin(t)) return DASH;
    var f = tm('stampLabel');
    if (f) return f(t);
    var r = fmtCall('stamp', t);
    return r != null ? r : DASH;
  }

  /* ---------------- metrics ---------------- */
  var METRICS = [
    { value: 'revenue', label: 'Revenue' }, { value: 'conversions', label: 'Conversions' },
    { value: 'clicks', label: 'Clicks' }, { value: 'roas', label: 'Return on spend' }
  ];
  var EXTRA_METRICS = { unsubRate: 'Unsubscribe rate', ctr: 'Click rate', openRate: 'Open rate', convRate: 'Conversion rate',
    react: 'Reactivations', cost: 'Spend', spend: 'Spend', sends: 'Sends', opens: 'Opens', unsubs: 'Unsubscribes' };
  var RATIO_METRICS = { roas: 1, ctr: 1, openRate: 1, convRate: 1, unsubRate: 1 };
  var MONEY_METRICS = { revenue: 1, cost: 1, spend: 1 };
  function metricLabel(m) {
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].value === m) return METRICS[i].label;
    return EXTRA_METRICS[m] || 'Revenue';
  }
  function metricFmt(m) {
    if (MONEY_METRICS[m]) return moneyC;
    if (m === 'roas') return ratio;
    if (m === 'unsubRate') return function (n) { return pct(n, 2); };
    if (RATIO_METRICS[m]) return function (n) { return pct(n, 1); };
    return function (n) { return num(n, { compact: Math.abs(n) >= 10000 }); };
  }
  function axisFmt(m) {
    if (MONEY_METRICS[m]) return 'moneyCompact';
    if (m === 'roas') return 'ratio';
    if (RATIO_METRICS[m]) return 'pct';
    return 'compact';
  }
  function isRatio(m) { return !!RATIO_METRICS[m]; }

  var RANGES = [
    { value: '14', label: 'Last 14 days' }, { value: '30', label: '30 days' },
    { value: '60', label: '60 days' }, { value: 'all', label: 'All history' }
  ];
  function rangeValue(v) { return v === 'all' ? 'all' : (Number(v) || 30); }
  function rangeLabel(r) { return r === 'all' ? 'across all history' : 'over the last ' + r + ' days'; }

  function CH() { return MC.CH || { ALL: ['email', 'sms', 'push', 'social', 'web'], OWNED: ['email', 'sms', 'push'], PAID: ['social', 'web'], IDX: { email: 0, sms: 1, push: 2, social: 3, web: 4 }, LABEL: { email: 'Email', sms: 'SMS', push: 'Push', social: 'Social ads', web: 'Web ads' } }; }
  function chLabel(ch) { return CH().LABEL[ch] || ch; }
  /* Color follows the entity, never its rank: channel index -> fixed chart token. */
  function chColor(ch) { var i = CH().IDX[ch]; return 'chart-' + ((fin(i) ? i : 5) + 1); }
  function campColor(campaigns, cid) {
    var all = (campaigns && (campaigns.all || campaigns.order)) || [];
    var i = all.indexOf(cid);
    return 'chart-' + (((i < 0 ? 0 : i) % 6) + 1);
  }
  function agentName(id) {
    try { var d = MC.runtime && MC.runtime.def ? MC.runtime.def(id) : null; if (d && d.name) return d.name; } catch (e) { /* ignore */ }
    var names = { optimizer: 'Variant Optimizer', sendtime: 'Send-Time Tuner', pacer: 'Budget Pacer', guard: 'Fatigue Guard',
      analyst: 'Insight Analyst', copy: 'Copy Drafter', scout: 'Segment Scout', planner: 'Campaign Planner' };
    return names[id] || id;
  }
  function dispatch(action) {
    try { return MC.store.dispatch(action) || { ok: false, error: 'No response' }; }
    catch (e) { return { ok: false, error: e && e.message ? e.message : 'Action failed' }; }
  }

  /* ---------------- model math (MC.models when present; contract-identical fallbacks) ---------------- */
  function response(c, s) {
    if (has(MC.models, 'response')) { try { var r = MC.models.response(c, s); if (fin(r)) return r; } catch (e) { /* fallback */ } }
    return c.A * (1 - Math.exp(-Math.max(0, s) / c.B));
  }
  function marginal(c, s) {
    if (has(MC.models, 'marginal')) { try { var r = MC.models.marginal(c, s); if (fin(r)) return r; } catch (e) { /* fallback */ } }
    return (c.A / c.B) * Math.exp(-Math.max(0, s) / c.B);
  }
  /* Grid over B (20 log-spaced values, 0.2x..5x mean spend), A by closed-form least squares, best r2.
     r2 < 0.3 falls back to the prior B = 2*meanSpend, A = meanRevenue / (1 - e^-0.5). */
  function localFit(points) {
    var pts = points.filter(function (p) { return fin(p.spend) && fin(p.revenue) && p.spend > 0; });
    var n = pts.length;
    if (!n) return null;
    var ms = 0, mr = 0;
    pts.forEach(function (p) { ms += p.spend; mr += p.revenue; });
    ms /= n; mr /= n;
    var sst = 0;
    pts.forEach(function (p) { sst += (p.revenue - mr) * (p.revenue - mr); });
    var best = null;
    for (var k = 0; k < 20; k++) {
      var B = ms * 0.2 * Math.pow(25, k / 19);
      var sgg = 0, srg = 0;
      pts.forEach(function (p) { var g = 1 - Math.exp(-p.spend / B); sgg += g * g; srg += p.revenue * g; });
      if (!(sgg > 0)) continue;
      var A = Math.max(0, srg / sgg), sse = 0;
      pts.forEach(function (p) { var e = p.revenue - A * (1 - Math.exp(-p.spend / B)); sse += e * e; });
      var r2 = sst > 0 ? 1 - sse / sst : 0;
      if (!best || r2 > best.r2) best = { A: A, B: B, r2: r2, sse: sse };
    }
    var out;
    if (best && best.r2 >= 0.3 && n >= 3) out = { A: best.A, B: best.B, r2: best.r2, sd: Math.sqrt(best.sse / Math.max(1, n - 1)) };
    else {
      var Bp = 2 * ms, Ap = mr / (1 - Math.exp(-0.5)), sse2 = 0;
      pts.forEach(function (p) { var e = p.revenue - Ap * (1 - Math.exp(-p.spend / Bp)); sse2 += e * e; });
      out = { A: Ap, B: Bp, r2: best ? best.r2 : 0, sd: Math.sqrt(sse2 / Math.max(1, n - 1)), prior: true };
    }
    return out;
  }
  function fitCurve(points) {
    if (has(MC.models, 'fitResponse')) {
      try {
        var c = MC.models.fitResponse(points);
        if (c && fin(c.A) && fin(c.B) && c.A > 0 && c.B > 0) return { A: c.A, B: c.B, r2: fin(c.r2) ? c.r2 : 0, sd: fin(c.sd) ? c.sd : 0 };
      } catch (e) { /* fallback */ }
    }
    return localFit(points);
  }
  /* EWMA z-score flags on complete days: mu <- l*y + (1-l)*mu, s2 <- l*(y-mu)^2 + (1-l)*s2. */
  function ewmaFlags(values, opt) {
    opt = opt || {};
    var lambda = opt.lambda || 0.2, zc = opt.z || 3, minN = opt.minN || 7;
    var raw = null;
    if (has(MC.models, 'ewma')) { try { raw = MC.models.ewma(values, { lambda: lambda, z: zc, minN: minN }); } catch (e) { raw = null; } }
    if (!Array.isArray(raw)) {
      raw = [];
      if (values.length > minN) {
        var seed = values.slice(0, minN), mu = 0, s2 = 0;
        seed.forEach(function (v) { mu += v; }); mu /= minN;
        seed.forEach(function (v) { s2 += (v - mu) * (v - mu); }); s2 /= Math.max(1, minN - 1);
        for (var i = minN; i < values.length; i++) {
          var y = values[i], z = s2 > 0 ? (y - mu) / Math.sqrt(s2) : 0;
          raw.push({ i: i, value: y, expected: mu, z: z });
          var nmu = lambda * y + (1 - lambda) * mu;
          s2 = lambda * (y - nmu) * (y - nmu) + (1 - lambda) * s2;
          mu = nmu;
        }
      }
    }
    return raw.filter(function (r) { return r && fin(r.z) && Math.abs(r.z) >= zc; });
  }
  /* Equal-marginal-return split of a fixed daily total across fitted curves (bisection on lambda). */
  function optimizeSplit(curves, total) {
    var keys = Object.keys(curves).sort();
    if (!keys.length || !(total > 0)) return null;
    function spendAt(lam) {
      var out = {}, sum = 0;
      keys.forEach(function (k) {
        var c = curves[k], top = c.A / c.B;
        var s = lam >= top ? 0 : c.B * Math.log(top / lam);
        out[k] = s; sum += s;
      });
      return { by: out, sum: sum };
    }
    var hi = 0;
    keys.forEach(function (k) { hi = Math.max(hi, curves[k].A / curves[k].B); });
    var lo = hi * 1e-9;
    for (var it = 0; it < 80; it++) {
      var mid = Math.sqrt(lo * hi);
      if (spendAt(mid).sum > total) lo = mid; else hi = mid;
    }
    var res = spendAt(hi), scale = res.sum > 0 ? total / res.sum : 0;
    keys.forEach(function (k) { res.by[k] = res.by[k] * scale; });
    return res.by;
  }

  /* ---------------- small kit wrappers (MC.ui first, accessible local fallback) ---------------- */
  function Seg(p) {
    var K = kit('Segmented');
    if (K) return html`<${K} id=${p.id} label=${p.label} options=${p.options} value=${p.value} onChange=${p.onChange} size=${p.size || 'sm'} />`;
    function onKey(e) {
      var i = -1;
      p.options.forEach(function (o, k) { if (o.value === p.value) i = k; });
      var n = p.options.length, j = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
      else return;
      e.preventDefault();
      p.onChange(p.options[j].value);
      var btn = e.currentTarget.querySelectorAll('[role="radio"]')[j];
      if (btn) btn.focus();
    }
    return html`<div id=${p.id} role="radiogroup" aria-label=${p.label} className="an-seg" onKeyDown=${onKey}>
      ${p.options.map(function (o) {
        var on = o.value === p.value;
        return html`<button key=${o.value} type="button" role="radio" aria-checked=${on ? 'true' : 'false'} tabIndex=${on ? 0 : -1}
          className=${'an-seg-opt' + (on ? ' is-on' : '')} onClick=${function () { p.onChange(o.value); }}>${o.label}</button>`;
      })}
    </div>`;
  }
  function Btn(p) {
    var K = kit('Button');
    if (K) return html`<${K} kind=${p.kind || 'secondary'} size=${p.size || 'sm'} onClick=${p.onClick} disabled=${p.disabled} title=${p.title} type="button" icon=${p.icon}>${p.children}<//>`;
    return html`<button type="button" className=${'an-btn an-btn-' + (p.kind || 'secondary')} onClick=${p.onClick} disabled=${p.disabled} title=${p.title}>${p.children}</button>`;
  }
  function Pill(p) {
    var K = kit('Pill');
    if (K) return html`<${K} tone=${p.tone || 'neutral'}>${p.children}<//>`;
    return html`<span className=${'an-pill an-tone-' + (p.tone || 'neutral')}>${p.children}</span>`;
  }
  function Chip(p) {
    var K = kit('AgentChip');
    if (K) return html`<${K} agentId=${p.agentId} size="sm" />`;
    return html`<span className="an-agent-chip"><span className="an-agent-dot" aria-hidden="true"></span>${agentName(p.agentId)}</span>`;
  }
  function Confirm(p) {
    var K = kit('InlineConfirm');
    if (K) return html`<${K} message=${p.message} confirmLabel=${p.confirmLabel} cancelLabel=${p.cancelLabel} onConfirm=${p.onConfirm} onCancel=${p.onCancel} tone=${p.tone} />`;
    return html`<div className="an-confirm" role="group" aria-label="Confirm">
      <span className="an-confirm-msg">${p.message}</span>
      <span className="an-actions">
        <${Btn} kind="primary" onClick=${p.onConfirm}>${p.confirmLabel || 'Confirm'}<//>
        <${Btn} kind="ghost" onClick=${p.onCancel}>${p.cancelLabel || 'Cancel'}<//>
      </span>
    </div>`;
  }
  function Empty(p) {
    return html`<div className="an-empty" role="note"><strong>${p.title}</strong>${p.body ? html`<span>${p.body}</span>` : null}</div>`;
  }
  function Card(p) {
    var tid = p.id + '-title';
    return html`<section id=${p.id} className=${'an-card ' + (p.className || '')} aria-labelledby=${tid}>
      <header className="an-card-head">
        <div className="an-card-titles">
          <h2 id=${tid} tabIndex="-1" className="an-card-title">${p.title}</h2>
          ${p.sub ? html`<p className="an-card-sub">${p.sub}</p>` : null}
        </div>
        ${p.actions ? html`<div className="an-card-actions">${p.actions}</div>` : null}
      </header>
      <div className="an-card-body">${p.children}</div>
    </section>`;
  }
  function chartOr(name) { return MC.charts && typeof MC.charts[name] === 'function' ? MC.charts[name] : null; }
  function NoChart() { return html`<${Empty} title="Charts are still loading." />`; }

  /* ---------------- sortable table: values update in place, order frozen while focused ---------------- */
  function Table(p) {
    var React = R();
    var st = React.useState({ key: p.sortKey || null, dir: p.sortDir || 'desc' }), s = st[0], setS = st[1];
    var focusRef = React.useRef(false), orderRef = React.useRef(null), forceRef = React.useRef(true);
    var rowKey = p.rowKey || function (r) { return r.id; };
    var rows = p.rows || [];
    var col = null;
    (p.columns || []).forEach(function (c) { if (c.key === s.key) col = c; });
    var sorted = rows;
    if (col && col.sortValue) {
      sorted = rows.slice().sort(function (a, b) {
        var va = col.sortValue(a), vb = col.sortValue(b);
        var na = va === null || va === undefined || (typeof va === 'number' && !isFinite(va));
        var nb = vb === null || vb === undefined || (typeof vb === 'number' && !isFinite(vb));
        if (na !== nb) return na ? 1 : -1;
        if (!na && va !== vb) { var c = va < vb ? -1 : 1; return s.dir === 'asc' ? c : -c; }
        var ka = String(rowKey(a)), kb = String(rowKey(b));
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
    }
    var order = sorted.map(rowKey);
    if (forceRef.current || !focusRef.current || !orderRef.current) { orderRef.current = order; forceRef.current = false; }
    var byKey = {};
    rows.forEach(function (r) { byKey[rowKey(r)] = r; });
    var shown = [], seen = {};
    orderRef.current.forEach(function (k) { if (byKey[k] && !seen[k]) { seen[k] = 1; shown.push(byKey[k]); } });
    order.forEach(function (k) { if (!seen[k]) { seen[k] = 1; shown.push(byKey[k]); } });
    function sortBy(c) {
      forceRef.current = true;
      setS(function (prev) { return { key: c.key, dir: prev.key === c.key ? (prev.dir === 'desc' ? 'asc' : 'desc') : (c.firstDir || 'desc') }; });
    }
    if (!rows.length) return html`<${Empty} title=${p.empty || 'Nothing to show for these filters yet.'} />`;
    return html`<div className="an-table-wrap k-scroll-x"
        onFocus=${function () { focusRef.current = true; }}
        onBlur=${function (e) { if (!e.currentTarget.contains(e.relatedTarget)) focusRef.current = false; }}>
      <table id=${p.id} className="an-table num">
        ${p.caption ? html`<caption className="an-visually-hidden">${p.caption}</caption>` : null}
        <thead><tr>${p.columns.map(function (c) {
          var active = s.key === c.key;
          var aria = active ? (s.dir === 'asc' ? 'ascending' : 'descending') : null;
          return html`<th key=${c.key} scope="col" aria-sort=${c.sortValue ? (aria || 'none') : null} className=${'an-th' + (c.align === 'right' ? ' is-right' : '')}>
            ${c.sortValue ? html`<button type="button" className="an-sort" onClick=${function () { sortBy(c); }}>
              ${c.label}<span aria-hidden="true" className="an-sort-ind">${active ? (s.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span></button>` : c.label}
          </th>`;
        })}</tr></thead>
        <tbody>${shown.map(function (r) {
          var k = rowKey(r);
          return html`<tr key=${k}>${p.columns.map(function (c, j) {
            var v = c.render ? c.render(r) : r[c.key];
            return j === 0
              ? html`<th key=${c.key} scope="row" className="an-td an-td-head">${v}</th>`
              : html`<td key=${c.key} className=${'an-td' + (c.align === 'right' ? ' is-right' : '')}>${v}</td>`;
          })}</tr>`;
        })}</tbody>
      </table>
    </div>`;
  }

  /* ---------------- filter bar ---------------- */
  function FilterBar(p) {
    var fo = p.focus, ids = fo.campaignIds || [];
    function set(patch) { if (MC.uiStore && MC.uiStore.setFocus) MC.uiStore.setFocus('analytics', patch); }
    var metricOpts = METRICS.slice();
    if (!METRICS.some(function (m) { return m.value === fo.metric; }) && EXTRA_METRICS[fo.metric]) metricOpts.push({ value: fo.metric, label: EXTRA_METRICS[fo.metric] });
    return html`<div className="an-filters" role="group" aria-label="Analytics filters">
      <div className="an-filter">
        <span className="an-filter-label" id="analytics-range-label">Range</span>
        <${Seg} id="analytics-range" label="Date range" value=${String(fo.range)} options=${RANGES}
          onChange=${function (v) { set({ range: rangeValue(v) }); }} />
      </div>
      <div className="an-filter an-filter-camps">
        <label className="an-filter-label" htmlFor="analytics-campaigns">Campaign</label>
        <select id="analytics-campaigns" className="an-select" value=${ids.length === 1 ? ids[0] : (ids.length ? '__many' : '')}
            onChange=${function (e) { var v = e.target.value; if (v !== '__many') set({ campaignIds: v ? [v] : [] }); }}>
          <option value="">All campaigns</option>
          ${ids.length > 1 ? html`<option value="__many">${ids.length + ' campaigns'}</option>` : null}
          ${p.campaigns.map(function (c) { return html`<option key=${c.id} value=${c.id}>${c.name}</option>`; })}
        </select>
      </div>
      <div className="an-filter">
        <label className="an-filter-label" htmlFor="analytics-channel">Channel</label>
        <select id="analytics-channel" className="an-select" value=${fo.channel || 'all'} onChange=${function (e) { set({ channel: e.target.value }); }}>
          <option value="all">All channels</option>
          ${CH().ALL.map(function (ch) { return html`<option key=${ch} value=${ch}>${chLabel(ch)}</option>`; })}
        </select>
      </div>
      <div className="an-filter">
        <label className="an-filter-label" htmlFor="analytics-metric">Metric</label>
        <select id="analytics-metric" className="an-select" value=${fo.metric || 'revenue'} onChange=${function (e) { set({ metric: e.target.value }); }}>
          ${metricOpts.map(function (m) { return html`<option key=${m.value} value=${m.value}>${m.label}</option>`; })}
        </select>
      </div>
      <div className="an-filter an-filter-toggle">
        <input id="analytics-show-agents" type="checkbox" className="an-check" checked=${fo.showAgents !== false}
          onChange=${function (e) { set({ showAgents: e.target.checked }); }} />
        <label htmlFor="analytics-show-agents">Show agent actions</label>
      </div>
    </div>`;
  }

  /* ---------------- shared derivations ---------------- */
  var EMPTY = [];
  function sumBand(points) {
    var mean = 0, v = 0;
    (points || EMPTY).forEach(function (q) {
      if (fin(q.mean)) mean += q.mean;
      if (fin(q.hi80) && fin(q.lo80)) { var sd = (q.hi80 - q.lo80) / (2 * Z80); v += sd * sd; }
    });
    var s = Math.sqrt(v);
    return { mean: mean, lo: Math.max(0, mean - Z80 * s), hi: mean + Z80 * s };
  }
  function aggregate(values, metric) {
    var vals = values.filter(fin);
    if (!vals.length) return null;
    var s = 0;
    vals.forEach(function (v) { s += v; });
    return isRatio(metric) ? s / vals.length : s;
  }
  function campaignNames(campaigns, ids) {
    if (!ids || !ids.length || !campaigns) return 'all campaigns and organic orders';
    var names = ids.map(function (id) { var c = campaigns.byId[id]; return c ? c.name : null; }).filter(Boolean);
    if (names.length <= 2) return names.join(' and ');
    return names[0] + ', ' + names[1] + ' and ' + (names.length - 2) + ' more';
  }
  function splitEntities(campaigns, f, mode) {
    if (mode === 'channel') {
      var chs = f.channel && f.channel !== 'all' ? [f.channel] : CH().ALL;
      return chs.map(function (ch) {
        return { id: ch, label: chLabel(ch), color: chColor(ch), f: { metric: f.metric, range: f.range, campaignIds: f.campaignIds, channel: ch } };
      });
    }
    if (mode === 'campaign' && campaigns) {
      var ids = f.campaignIds && f.campaignIds.length ? f.campaignIds
        : campaigns.order.filter(function (id) { var c = campaigns.byId[id]; return c && c.status !== 'draft'; });
      return ids.slice(0, 6).map(function (id) {
        var c = campaigns.byId[id];
        return { id: id, label: c ? c.name : id, color: null, f: { metric: f.metric, range: f.range, campaignIds: [id], channel: f.channel } };
      });
    }
    return EMPTY;
  }

  /* ---------------- Performance ---------------- */
  function Performance(p) {
    var React = R(), H = hooks();
    var f = p.f, metric = f.metric;
    var sp = React.useState('total'), split = sp[0], setSplit = sp[1];
    var op = React.useState(null), openP = op[0], setOpenP = op[1];
    var fcArgs = React.useMemo(function () { return assign({}, f, { h: 14 }); }, [f]);
    var fc = H.useSelect(React.useCallback(function (w) { return has(sel(), 'forecast') ? sel().forecast(w, fcArgs) : null; }, [fcArgs]));
    var series = H.useSelect(React.useCallback(function (w) { return has(sel(), 'series') ? sel().series(w, f) : EMPTY; }, [f]));
    var showAgents = p.showAgents;
    var markersRaw = H.useSelect(React.useCallback(function (w) {
      return showAgents && has(sel(), 'agentMarkers') ? sel().agentMarkers(w, { range: f.range, campaignIds: f.campaignIds }) : EMPTY;
    }, [f, showAgents]));
    var anomalyIns = H.useSelect(React.useCallback(function (w) { return has(sel(), 'insights') ? sel().insights(w, { kinds: ['anomaly'] }) : EMPTY; }, []));
    var campaigns = H.useSelect(selCampaigns);
    var entities = React.useMemo(function () {
      return splitEntities(campaigns, f, split).map(function (e) { return e.color ? e : assign({}, e, { color: campColor(campaigns, e.id) }); });
    }, [campaigns, f, split]);
    var splitData = H.useSelect(React.useCallback(function (w) {
      return entities.map(function (e) { return has(sel(), 'series') ? sel().series(w, e.f) : EMPTY; });
    }, [entities]), sameItems);

    var vf = metricFmt(metric);
    var actual = (fc && fc.actual) || EMPTY;
    var points = (fc && fc.points) || EMPTY;
    var allZero = !actual.some(function (a) { return fin(a.value) && a.value !== 0; });
    var partial = null;
    (series || EMPTY).forEach(function (pt) { if (pt.partial) partial = pt; });

    var markers = React.useMemo(function () {
      var out = [], seen = {};
      if (split === 'total') {
        var flags = ewmaFlags(actual.map(function (a) { return a.value; }), { z: 3 });
        flags.forEach(function (fl) {
          var a = actual[fl.i];
          if (!a || seen[a.day]) return;
          seen[a.day] = 1;
          out.push({ x: a.day, kind: 'anomaly', tone: Math.abs(fl.z) >= 4 ? 'crit' : 'warn', y: a.value,
            label: 'Unusual ' + metricLabel(metric).toLowerCase() + ' on ' + dayShort(a.day) + ': ' + vf(a.value) + ' vs expected ' + vf(fl.expected) + ' (' + fl.z.toFixed(1) + 'σ)' });
        });
        if (f.campaignIds && f.campaignIds.length === 1) {
          (anomalyIns || EMPTY).forEach(function (ins) {
            var parts = String(ins.key || '').split('|');
            var d = Number(parts[3]);
            if (parts[1] !== f.campaignIds[0] || parts[2] !== metric || !fin(d) || seen[d]) return;
            var a = null;
            actual.forEach(function (q) { if (q.day === d) a = q; });
            if (!a) return;
            seen[d] = 1;
            out.push({ x: d, kind: 'anomaly', tone: ins.severity === 'crit' ? 'crit' : 'warn', y: a.value, label: ins.title || ins.body || 'Anomaly' });
          });
        }
      }
      var lo = actual.length ? actual[0].day : 0;
      var hi = points.length ? points[points.length - 1].day : (actual.length ? actual[actual.length - 1].day : 0);
      // Sale-event markers sit on the internal calendar; show them only when display dates match it.
      var evOk = !(MC.time && typeof MC.time.displayOffset === 'function' && MC.time.displayOffset() !== 0);
      (evOk && MC.time && MC.time.EVENTS || EMPTY).forEach(function (ev) {
        if (ev.day >= lo && ev.day <= hi) out.push({ x: ev.day, kind: 'event', label: ev.label });
      });
      (markersRaw || EMPTY).forEach(function (m) {
        out.push({ x: m.day, kind: 'agent', id: m.proposalId, proposalId: m.proposalId, label: m.label + ' (' + stamp(m.tick) + ')',
          onClick: function () { setOpenP(m.proposalId); } });
      });
      return out;
    }, [actual, points, markersRaw, anomalyIns, split, metric, f]);

    var FC = chartOr('ForecastChart'), LC = chartOr('LineChart');
    var chart;
    if (split === 'total') {
      if (!actual.length || allZero) chart = html`<${Empty} title="No sends in this range yet." body="Widen the range or pick another campaign." />`;
      else if (!FC) chart = html`<${NoChart} />`;
      else {
        var goal = fc && fin(fc.goal) ? { y: fc.goal, label: 'Daily pace for goal ' + vf(fc.goal) } : null;
        chart = html`<${FC} actual=${actual} forecast=${points} goal=${goal} markers=${markers} yFormat=${axisFmt(metric)}
          height=${260} labels=${{ actual: metricLabel(metric), forecast: 'Forecast (14 days)' }} label=${metricLabel(metric)} />`;
      }
    } else if (!LC) chart = html`<${NoChart} />`;
    else {
      var ser = entities.map(function (e, k) {
        var pts = ((splitData && splitData[k]) || EMPTY).filter(function (q) { return !q.partial; }).map(function (q) { return { x: q.day, y: q.value }; });
        return { id: e.id, label: e.label, color: e.color, points: pts };
      }).filter(function (s) { return s.points.some(function (q) { return q.y; }); });
      chart = ser.length
        ? html`<${LC} series=${ser} markers=${markers.filter(function (m) { return m.kind !== 'anomaly'; })} yFormat=${axisFmt(metric)} height=${260}
            ariaLabel=${metricLabel(metric) + ' by ' + split + ', ' + rangeLabel(f.range)} />`
        : html`<${Empty} title="No sends in this range yet." />`;
    }

    var last = aggregate(actual.map(function (a) { return a.value; }), metric);
    var nxt = sumBand(points);
    var nextVal = isRatio(metric) && points.length ? nxt.mean / points.length : nxt.mean;
    var PC = kit('ProposalCard');
    var splitOpts = [{ value: 'total', label: 'Total + forecast' }, { value: 'campaign', label: 'By campaign' }, { value: 'channel', label: 'By channel' }];
    return html`<${Card} id="analytics-performance" title="Performance"
        sub=${metricLabel(metric) + ' for ' + campaignNames(campaigns, f.campaignIds) + (f.channel && f.channel !== 'all' ? ' on ' + chLabel(f.channel) : '') + ', ' + rangeLabel(f.range) + '.'}
        actions=${html`<${Seg} id="analytics-split" label="Split performance" value=${split} options=${splitOpts} onChange=${setSplit} />`}>
      <dl className="an-stats">
        <div className="an-stat"><dt>${isRatio(metric) ? 'Average, complete days' : 'Complete days in range'}</dt><dd className="num">${last == null ? DASH : vf(last)}</dd></div>
        <div className="an-stat"><dt>Next 14 days (forecast)</dt>
          <dd className="num">${points.length ? vf(nextVal) : DASH}${points.length && !isRatio(metric) ? html`<span className="an-stat-sub">${vf(nxt.lo) + EN + vf(nxt.hi)} (80%)</span>` : null}</dd></div>
        <div className="an-stat"><dt>Today so far</dt><dd className="num">${partial ? vf(partial.value) : DASH}<span className="an-stat-sub">partial day, updates hourly</span></dd></div>
      </dl>
      ${split === 'total' && fc && !fc.ready && actual.length ? html`<p className="an-note">Forecast appears after 7 days of data.</p>` : null}
      ${chart}
      ${openP ? html`<div className="an-callout" role="region" aria-label="Agent change details">
          <div className="an-callout-head"><strong>Agent change</strong><${Btn} kind="ghost" onClick=${function () { setOpenP(null); }}>Close<//></div>
          ${PC ? html`<${PC} id=${openP} showTarget=${true} />` : html`<p className="an-note">${openP}</p>`}
        </div>` : null}
    <//>`;
  }

  /* ---------------- Agent impact ---------------- */
  function impactValue(v, unit) {
    if (!fin(v)) return DASH;
    if (unit === '$') return moneySigned(v);
    if (unit === 'pp') return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + ' pp';
    return (v > 0 ? '+' : '') + num(v);
  }
  var STATUS_TEXT = { realized: 'Realized', 'not-measured': 'Not measured', undone: 'Undone' };
  function AgentImpact(p) {
    var React = R(), H = hooks();
    var f = p.f, ids = f.campaignIds || EMPTY;
    var imp = H.useSelect(React.useCallback(function (w) { return has(sel(), 'agentImpact') ? sel().agentImpact(w) : null; }, []));
    var proposals = H.useSelect(selProposals);
    var campaigns = H.useSelect(selCampaigns);
    var sa = React.useState(false), showAll = sa[0], setShowAll = sa[1];
    var rows = React.useMemo(function () {
      var list = (imp && imp.rows) || EMPTY;
      if (!ids.length) return list;
      var w = MC.store.getState();
      return list.filter(function (r) {
        var pr = proposals && proposals.byId[r.proposalId];
        var cid = pr && has(sel(), 'targetCampaignId') ? sel().targetCampaignId(w, pr) : null;
        return ids.indexOf(cid) >= 0;
      });
    }, [imp, proposals, ids]);
    var totals = React.useMemo(function () {
      if (!ids.length && imp) return imp.totals;
      var e = 0, r = 0;
      rows.forEach(function (x) {
        if (x.unit !== '$') return;
        if (x.status !== 'undone' && fin(x.expected)) e += x.expected;
        if (x.status === 'realized' && fin(x.realized)) r += x.realized;
      });
      return { expected: e, realized: r };
    }, [rows, imp, ids]);
    var liftIds = React.useMemo(function () {
      if (!campaigns) return EMPTY;
      var base = ids.length ? ids : campaigns.order;
      return base.filter(function (id) { var c = campaigns.byId[id]; return c && c.status !== 'draft' && c.status !== 'scheduled'; });
    }, [campaigns, ids]);
    var lifts = H.useSelect(React.useCallback(function (w) {
      return liftIds.map(function (id) { return has(sel(), 'liftVsControl') ? sel().liftVsControl(w, id) : null; });
    }, [liftIds]), sameItems);

    var sorted = rows.slice().sort(function (a, b) { return (b.appliedTick - a.appliedTick) || (a.proposalId < b.proposalId ? -1 : 1); });
    var shown = showAll ? sorted : sorted.slice(0, 8);
    var since = dayShort(0);
    var cols = [
      { key: 'title', label: 'Change', render: function (r) { return html`<span className="an-change">${r.title}</span>`; } },
      { key: 'agent', label: 'Agent', render: function (r) { return html`<${Chip} agentId=${r.agentId} />`; } },
      { key: 'applied', label: 'Applied', sortValue: function (r) { return r.appliedTick; }, render: function (r) { return stamp(r.appliedTick); } },
      { key: 'expected', label: 'Expected', align: 'right', sortValue: function (r) { return r.expected; }, render: function (r) { return impactValue(r.expected, r.unit); } },
      { key: 'realized', label: 'Realized (vs control)', align: 'right', sortValue: function (r) { return r.realized; }, render: function (r) {
        if (!fin(r.realized)) return DASH;
        return html`<span>${impactValue(r.realized, r.unit)}${fin(r.realizedLo) && fin(r.realizedHi) ? html`<span className="an-sub-num">${impactValue(r.realizedLo, r.unit) + ' to ' + impactValue(r.realizedHi, r.unit)}</span>` : null}</span>`;
      } },
      { key: 'status', label: 'Status', render: function (r) {
        if (r.status === 'measuring') return html`<${Pill} tone="agent">${'Measuring' + ELL + ' ' + (fin(r.hoursLeft) ? r.hoursLeft + 'h left' : '')}<//>`;
        return html`<${Pill} tone=${r.status === 'realized' ? (r.realized >= 0 ? 'good' : 'warn') : 'neutral'}>${STATUS_TEXT[r.status] || r.status}<//>`;
      } }
    ];
    return html`<${Card} id="analytics-agent-impact" title="Agent impact"
        sub="Every applied agent change, what it promised, and what it delivered against the 10% control group.">
      ${rows.length ? html`<p className="an-headline">
          Agents added <strong className="num">${moneySigned(totals.realized)}</strong> realized
          (expected <span className="num">${moneySigned(totals.expected)}</span>) since ${since}.
        </p>` : html`<${Empty} title="No agent changes applied yet." body="Agents on Autopilot apply low-risk changes as the clock runs; the rest wait in Approvals." />`}
      ${rows.length ? html`<${Table} id="analytics-impact-table" caption="Agent impact" columns=${cols} rows=${shown}
          rowKey=${function (r) { return r.proposalId; }} sortKey="applied" sortDir="desc" />` : null}
      ${sorted.length > 8 ? html`<div className="an-actions"><${Btn} kind="ghost" onClick=${function () { setShowAll(!showAll); }}>
          ${showAll ? 'Show fewer' : 'Show all ' + sorted.length}<//></div>` : null}
      <h3 className="an-subhead">Control group lift</h3>
      <ul className="an-lifts">
        ${liftIds.map(function (id, k) {
          var l = lifts ? lifts[k] : null, c = campaigns.byId[id];
          var body;
          if (!l) body = html`<span className="an-muted">Control group needs 100 sends before lift is measured.</span>`;
          else if (!fin(l.lift)) body = html`<span className="an-muted">No ${l.metric} in the control group yet.</span>`;
          else body = html`<span><strong className="num">${signedPct(l.lift)}</strong> ${l.metric} vs control <span className="an-muted num">(95% range ${signedPct(l.lo)} to ${signedPct(l.hi)}; ${num(l.trt.n)} vs ${num(l.ctl.n)} sends)</span></span>`;
          return html`<li key=${id} className="an-lift"><span className="an-lift-name">${c ? c.name : id}</span>${body}</li>`;
        })}
        ${liftIds.length ? null : html`<li className="an-muted">No live or completed campaigns in this filter.</li>`}
      </ul>
    <//>`;
  }

  /* ---------------- Funnel ---------------- */
  function FunnelSection(p) {
    var React = R(), H = hooks(), f = p.f;
    var init = f.channel && CH().OWNED.indexOf(f.channel) >= 0 ? f.channel : 'all';
    var cs = React.useState(init), ch = cs[0], setCh = cs[1];
    var args = React.useMemo(function () { return { range: f.range, campaignIds: f.campaignIds, channel: ch }; }, [f, ch]);
    var stages = H.useSelect(React.useCallback(function (w) { return has(sel(), 'funnel') ? sel().funnel(w, args) : EMPTY; }, [args]));
    var FN = chartOr('Funnel');
    var st = stages || EMPTY, sent = st[0] ? st[0].value : 0, conv = st[4] ? st[4].value : 0;
    var worst = null;
    for (var i = 1; i < st.length; i++) {
      var prev = st[i - 1].value;
      if (prev > 0) { var r = st[i].value / prev; if (!worst || r < worst.r) worst = { r: r, from: st[i - 1].label, to: st[i].label }; }
    }
    var opts = [{ value: 'all', label: 'All' }].concat(CH().OWNED.map(function (c) { return { value: c, label: chLabel(c) }; }));
    return html`<${Card} id="analytics-funnel" title="Funnel" sub=${'Owned-channel messages ' + rangeLabel(f.range) + ', stage by stage.'}
        actions=${html`<${Seg} id="analytics-funnel-channel" label="Funnel channel" value=${ch} options=${opts} onChange=${setCh} />`}>
      ${sent > 0 ? html`<p className="an-headline">Of <strong className="num">${num(sent)}</strong> messages sent, <strong className="num">${num(conv)}</strong> converted (<span className="num">${pct(conv / sent, 2)}</span>).
          ${worst ? html` The steepest drop is ${worst.from.toLowerCase()} ${'→'} ${worst.to.toLowerCase()}: <span className="num">${pct(worst.r)}</span> continue.` : null}</p>` : null}
      ${sent > 0 ? (FN ? html`<${FN} stages=${st} format="num" ariaLabel=${'Funnel: ' + num(sent) + ' sent, ' + num(conv) + ' converted'} />` : html`<${NoChart} />`)
        : html`<${Empty} title="No sends in this range yet." body="Owned channels (email, SMS, push) feed this funnel." />`}
    <//>`;
  }

  /* ---------------- Channels & variants ---------------- */
  function ChannelsSection(p) {
    var React = R(), H = hooks(), f = p.f;
    var ms = React.useState('roas'), measure = ms[0], setMeasure = ms[1];
    var args = React.useMemo(function () { return { range: f.range, campaignIds: f.campaignIds }; }, [f]);
    var rows = H.useSelect(React.useCallback(function (w) { return has(sel(), 'channelCompare') ? sel().channelCompare(w, args) : EMPTY; }, [args])) || EMPTY;
    var BC = chartOr('BarChart');
    var active = rows.filter(function (r) { return r.sends > 0 || r.impressions > 0 || r.cost > 0; });
    var best = null;
    active.forEach(function (r) { if (fin(r.roas) && (!best || r.roas > best.roas)) best = r; });
    var data = active.map(function (r) {
      if (measure === 'roas') return { key: r.ch, label: r.label || chLabel(r.ch), value: fin(r.roas) ? r.roas : 0, color: chColor(r.ch) };
      return { key: r.ch, label: r.label || chLabel(r.ch), value: r.ctr, ci: r.ci, color: chColor(r.ch) };
    });
    var cols = [
      { key: 'label', label: 'Channel', render: function (r) { return html`<span className="an-swatch-label"><span className="an-swatch" style=${{ background: 'var(--' + chColor(r.ch) + ')' }} aria-hidden="true"></span>${r.label || chLabel(r.ch)}</span>`; } },
      { key: 'reach', label: 'Sends / impr.', align: 'right', sortValue: function (r) { return r.sends || r.impressions; }, render: function (r) { return num(r.sends || r.impressions, { compact: true }); } },
      { key: 'clicks', label: 'Clicks', align: 'right', sortValue: function (r) { return r.clicks; }, render: function (r) { return num(r.clicks); } },
      { key: 'ctr', label: 'Click rate', align: 'right', sortValue: function (r) { return r.ctr; }, render: function (r) { return pct(r.ctr, 2); } },
      { key: 'conv', label: 'Conversions', align: 'right', sortValue: function (r) { return r.conv; }, render: function (r) { return num(r.conv); } },
      { key: 'revenue', label: 'Revenue', align: 'right', sortValue: function (r) { return r.revenue; }, render: function (r) { return moneyC(r.revenue); } },
      { key: 'cost', label: 'Spend', align: 'right', sortValue: function (r) { return r.cost; }, render: function (r) { return moneyC(r.cost); } },
      { key: 'roas', label: 'Return', align: 'right', sortValue: function (r) { return r.roas; }, render: function (r) { return ratio(r.roas); } }
    ];
    var measures = [{ value: 'roas', label: 'Return on spend' }, { value: 'ctr', label: 'Click rate' }];
    return html`<${Card} id="analytics-channels" title="Channels & variants" sub=${'Ranked by return ' + rangeLabel(f.range) + '. Click rate bars show 95% ranges.'}
        actions=${html`<${Seg} id="analytics-channel-measure" label="Channel measure" value=${measure} options=${measures} onChange=${setMeasure} />`}>
      ${best ? html`<p className="an-headline">${best.label || chLabel(best.ch)} returns <strong className="num">${ratio(best.roas)}</strong> on <span className="num">${moneyC(best.cost)}</span> of spend, the best of ${active.length} active channels.</p>` : null}
      ${active.length ? (BC ? html`<${BC} data=${data} orientation="h" format=${measure === 'roas' ? 'ratio' : 'pct'} highlightKey=${best ? best.ch : null}
          valueLabel=${measure === 'roas' ? 'Return on spend' : 'Click rate'} categoryLabel="Channel"
          ariaLabel=${(measure === 'roas' ? 'Return on spend' : 'Click rate') + ' by channel'} />` : html`<${NoChart} />`)
        : html`<${Empty} title="No sends in this range yet." />`}
      ${active.length ? html`<${Table} id="analytics-channel-table" caption="Channel comparison" columns=${cols} rows=${active}
          rowKey=${function (r) { return r.ch; }} sortKey="roas" sortDir="desc" />` : null}
      <${VariantBoard} f=${f} />
    <//>`;
  }

  function VariantBoard(p) {
    var React = R(), H = hooks(), f = p.f;
    var campaigns = H.useSelect(selCampaigns);
    var options = React.useMemo(function () {
      if (!campaigns) return EMPTY;
      return campaigns.order.filter(function (id) { var c = campaigns.byId[id]; return c && c.status !== 'draft'; });
    }, [campaigns]);
    var pick = f.campaignIds && f.campaignIds.length === 1 ? f.campaignIds[0] : null;
    var lc = React.useState(null), localCid = lc[0], setLocalCid = lc[1];
    var cid = pick || (localCid && options.indexOf(localCid) >= 0 ? localCid : null);
    if (!cid) { for (var i = 0; i < options.length; i++) { var c0 = campaigns.byId[options[i]]; if (c0.status === 'live') { cid = c0.id; break; } } }
    if (!cid && options.length) cid = options[0];
    var camp = cid && campaigns ? campaigns.byId[cid] : null;
    var owned = camp ? camp.channels.filter(function (c) { return CH().OWNED.indexOf(c) >= 0; }) : EMPTY;
    var vc = React.useState(null), vch = vc[0], setVch = vc[1];
    var ch = vch && owned.indexOf(vch) >= 0 ? vch : (owned[0] || null);
    var stats = H.useSelect(React.useCallback(function (w) { return cid && ch && has(sel(), 'variantStats') ? sel().variantStats(w, cid, ch) : EMPTY; }, [cid, ch])) || EMPTY;
    if (!camp) return null;
    var BC = chartOr('BarChart');
    var reward = stats[0] ? stats[0].reward : 'conversions';
    var leader = null;
    stats.forEach(function (v) { if (fin(v.pBest) && (!leader || v.pBest > leader.pBest)) leader = v; });
    var data = stats.map(function (v) {
      var val = reward === 'clicks' ? v.clickRate : v.convPerSend;
      return { key: v.id, label: v.name + (v.status !== 'live' ? ' (' + v.status + ')' : ''), value: val, ci: v.ci, color: 'chart-1' };
    });
    var cols = [
      { key: 'name', label: 'Variant', render: function (v) { return 'Variant ' + v.name; } },
      { key: 'author', label: 'Author', render: function (v) { return v.author && v.author.indexOf('agent:') === 0 ? html`<${Chip} agentId=${v.author.slice(6)} />` : 'You'; } },
      { key: 'share', label: 'Traffic share', align: 'right', sortValue: function (v) { return v.share; }, render: function (v) {
        return fin(v.prevShare) && Math.abs(v.prevShare - v.share) > 0.004 ? pct(v.prevShare, 0) + ARROW + pct(v.share, 0) : pct(v.share, 0); } },
      { key: 'sends', label: 'Sends', align: 'right', sortValue: function (v) { return v.sends; }, render: function (v) { return num(v.sends); } },
      { key: 'rate', label: reward === 'clicks' ? 'Clicks / send' : 'Conv. / send', align: 'right', sortValue: function (v) { return reward === 'clicks' ? v.clickRate : v.convPerSend; },
        render: function (v) { return pct(reward === 'clicks' ? v.clickRate : v.convPerSend, 2); } },
      { key: 'pBest', label: 'Chance best', align: 'right', sortValue: function (v) { return v.pBest; }, render: function (v) { return fin(v.pBest) ? pct(v.pBest, 0) : DASH; } }
    ];
    return html`<div className="an-variants">
      <div className="an-variants-head">
        <h3 className="an-subhead">Variants in ${camp.name}</h3>
        <div className="an-inline-controls">
          ${pick ? null : html`<label className="an-filter-label" htmlFor="analytics-variant-campaign">Campaign</label>
            <select id="analytics-variant-campaign" className="an-select" value=${cid} onChange=${function (e) { setLocalCid(e.target.value); }}>
              ${options.map(function (id) { return html`<option key=${id} value=${id}>${campaigns.byId[id].name}</option>`; })}
            </select>`}
          ${owned.length > 1 ? html`<${Seg} id="analytics-variant-channel" label="Variant channel" value=${ch}
              options=${owned.map(function (c) { return { value: c, label: chLabel(c) }; })} onChange=${setVch} />` : null}
        </div>
      </div>
      ${!owned.length ? html`<${Empty} title="This campaign runs on paid channels only." />`
        : !stats.length || !stats.some(function (v) { return v.sends > 0; }) ? html`<${Empty} title="No variant sends yet." body="Variant results appear once the campaign starts sending." />`
        : html`<div>
          ${leader ? html`<p className="an-headline">Variant ${leader.name} leads with a <strong className="num">${pct(leader.pBest, 0)}</strong> chance of being best on ${reward} per send.</p>` : null}
          ${BC ? html`<${BC} data=${data} orientation="h" format="pct" highlightKey=${leader ? leader.id : null} valueLabel=${reward === 'clicks' ? 'Clicks per send' : 'Conversions per send'}
              categoryLabel="Variant" ariaLabel=${'Variant ' + reward + ' per send with 95% ranges'} />` : null}
          <${Table} id="analytics-variant-table" caption="Variant leaderboard" columns=${cols} rows=${stats} rowKey=${function (v) { return v.id; }} sortKey="pBest" sortDir="desc" />
        </div>`}
    </div>`;
  }

  /* ---------------- Attribution ---------------- */
  function sumObj(o) { var s = 0; Object.keys(o || {}).forEach(function (k) { if (fin(o[k])) s += o[k]; }); return s; }
  function AttributionSection(p) {
    var React = R(), H = hooks(), f = p.f;
    var ms = React.useState('last'), model = ms[0], setModel = ms[1];
    var aLast = React.useMemo(function () { return { range: f.range, campaignIds: f.campaignIds, model: 'last' }; }, [f]);
    var aLin = React.useMemo(function () { return { range: f.range, campaignIds: f.campaignIds, model: 'linear' }; }, [f]);
    var last = H.useSelect(React.useCallback(function (w) { return has(sel(), 'attribution') ? sel().attribution(w, aLast) : null; }, [aLast]));
    var lin = H.useSelect(React.useCallback(function (w) { return has(sel(), 'attribution') ? sel().attribution(w, aLin) : null; }, [aLin]));
    var campaigns = H.useSelect(selCampaigns);
    var cur = model === 'linear' ? lin : last;
    var SB = chartOr('StackedBar');
    var total = cur ? sumObj(cur.byChannel) : 0;
    var chs = CH().ALL;
    var rows = [];
    if (cur && campaigns) {
      var keys = Object.keys(cur.byCampaign || {});
      var order = campaigns.all || campaigns.order;
      keys.sort(function (a, b) { var ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || (a < b ? -1 : 1); });
      keys.forEach(function (cid) {
        var bc = cur.byCampaign[cid], c = campaigns.byId[cid];
        if (sumObj(bc) <= 0) return;
        rows.push({ key: cid, label: c ? c.name : cid, parts: chs.map(function (ch) { return { key: ch, value: bc[ch] || 0 }; }) });
      });
    }
    var keysOut = chs.filter(function (ch) { return cur && cur.byChannel && cur.byChannel[ch] > 0; })
      .map(function (ch) { return { key: ch, label: chLabel(ch), color: chColor(ch) }; });
    rows.forEach(function (r) { r.parts = r.parts.filter(function (pt) { return keysOut.some(function (k) { return k.key === pt.key; }); }); });
    var tl = last ? sumObj(last.byChannel) : 0, tn = lin ? sumObj(lin.byChannel) : 0;
    var compare = chs.map(function (ch) {
      var a = tl > 0 && last ? (last.byChannel[ch] || 0) / tl : 0, b = tn > 0 && lin ? (lin.byChannel[ch] || 0) / tn : 0;
      return { ch: ch, label: chLabel(ch), lastShare: a, linShare: b, shift: b - a, lastRev: last ? last.byChannel[ch] || 0 : 0, linRev: lin ? lin.byChannel[ch] || 0 : 0 };
    }).filter(function (r) { return r.lastRev > 0 || r.linRev > 0; });
    var mover = null;
    compare.forEach(function (r) { if (!mover || Math.abs(r.shift) > Math.abs(mover.shift)) mover = r; });
    var cols = [
      { key: 'label', label: 'Channel', render: function (r) { return html`<span className="an-swatch-label"><span className="an-swatch" style=${{ background: 'var(--' + chColor(r.ch) + ')' }} aria-hidden="true"></span>${r.label}</span>`; } },
      { key: 'last', label: 'Last touch', align: 'right', sortValue: function (r) { return r.lastRev; }, render: function (r) { return moneyC(r.lastRev) + ' · ' + pct(r.lastShare, 0); } },
      { key: 'lin', label: 'Linear', align: 'right', sortValue: function (r) { return r.linRev; }, render: function (r) { return moneyC(r.linRev) + ' · ' + pct(r.linShare, 0); } },
      { key: 'shift', label: 'Share shift', align: 'right', sortValue: function (r) { return r.shift; }, render: function (r) { return (r.shift >= 0 ? '+' : '-') + (Math.abs(r.shift) * 100).toFixed(1) + ' pp'; } }
    ];
    var opts = [{ value: 'last', label: 'Last touch' }, { value: 'linear', label: 'Linear' }];
    return html`<${Card} id="analytics-attribution" title="Attribution" sub=${'Revenue credited to campaign touches within 7 days, ' + rangeLabel(f.range) + '.'}
        actions=${html`<${Seg} id="analytics-attr-model" label="Attribution model" value=${model} options=${opts} onChange=${setModel} />`}>
      ${total > 0 ? html`<p className="an-headline"><strong className="num">${moneyC(total)}</strong> attributed under ${model === 'linear' ? 'linear' : 'last-touch'} credit.
          ${mover && Math.abs(mover.shift) >= 0.005 ? html` Switching models moves ${mover.label} by <span className="num">${(mover.shift >= 0 ? '+' : '-') + (Math.abs(mover.shift) * 100).toFixed(1)} pp</span> of the credit.` : null}</p>` : null}
      ${rows.length ? (SB ? html`<${SB} rows=${rows} keys=${keysOut} format="moneyCompact" rowLabel="Campaign"
          ariaLabel=${'Attributed revenue by channel per campaign, ' + (model === 'linear' ? 'linear' : 'last touch')} />` : html`<${NoChart} />`)
        : html`<${Empty} title="No attributed revenue in this range yet." body="Revenue is credited when a customer buys within 7 days of a campaign touch." />`}
      ${compare.length ? html`<${Table} id="analytics-attr-table" caption="Last touch vs linear by channel" columns=${cols} rows=${compare}
          rowKey=${function (r) { return r.ch; }} sortKey="last" sortDir="desc" />` : null}
    <//>`;
  }

  /* ---------------- Return by audience ---------------- */
  function AudienceSection() {
    var React = R(), H = hooks();
    var rows = H.useSelect(React.useCallback(function (w) { return has(sel(), 'segmentRows') ? sel().segmentRows(w) : EMPTY; }, [])) || EMPTY;
    var campaigns = H.useSelect(selCampaigns);
    var BC = chartOr('BarChart');
    var ranked = rows.filter(function (r) { return fin(r.roas); }).slice().sort(function (a, b) { return (b.roas - a.roas) || (a.id < b.id ? -1 : 1); });
    var avg = 0;
    ranked.forEach(function (r) { avg += r.roas; });
    avg = ranked.length ? avg / ranked.length : 0;
    var top = ranked[0];
    var cols = [
      { key: 'name', label: 'Audience', render: function (r) { return html`<span>${r.name}${r.author && r.author.indexOf('agent:') === 0 ? html` <${Chip} agentId=${r.author.slice(6)} />` : null}</span>`; } },
      { key: 'count', label: 'People', align: 'right', sortValue: function (r) { return r.count; }, render: function (r) { return num(r.count); } },
      { key: 'prop', label: 'Avg propensity', align: 'right', sortValue: function (r) { return r.meanProp; }, render: function (r) { return pct(r.meanProp, 1); } },
      { key: 'ltv', label: 'Predicted LTV', align: 'right', sortValue: function (r) { return r.meanLtv; }, render: function (r) { return money(r.meanLtv); } },
      { key: 'roas', label: 'Return', align: 'right', sortValue: function (r) { return r.roas; }, render: function (r) { return ratio(r.roas); } },
      { key: 'used', label: 'Used in', render: function (r) {
        var names = (r.usedIn || EMPTY).map(function (id) { var c = campaigns && campaigns.byId[id]; return c ? c.name : id; });
        return names.length ? names.join(', ') : html`<span className="an-muted">Not in a campaign</span>`;
      } }
    ];
    return html`<${Card} id="analytics-audiences" title="Return by audience"
        sub="Lifetime revenue per dollar for campaigns aimed at each segment, with predicted value per person.">
      ${top ? html`<p className="an-headline">${top.name} returns <strong className="num">${ratio(top.roas)}</strong>${ranked.length > 1 && avg > 0 ? ', ' : '.'}${ranked.length > 1 && avg > 0 ? html`<span className="num">${ratio(top.roas / avg)}</span> the average targeted audience.` : null}</p>` : null}
      ${ranked.length ? (BC ? html`<${BC} data=${ranked.slice(0, 8).map(function (r) { return { key: r.id, label: r.name, value: r.roas, color: 'chart-2' }; })}
          orientation="h" format="ratio" highlightKey=${top ? top.id : null} valueLabel="Return on spend" categoryLabel="Audience"
          ariaLabel="Return on spend by targeted audience" />` : html`<${NoChart} />`)
        : html`<${Empty} title="No audience has campaign spend yet." />`}
      ${rows.length ? html`<${Table} id="analytics-audience-table" caption="Audiences ranked by return" columns=${cols} rows=${rows}
          rowKey=${function (r) { return r.id; }} sortKey="roas" sortDir="desc" />` : null}
    <//>`;
  }

  /* ---------------- Anomalies ---------------- */
  function parseAnomalyKey(key) {
    var parts = String(key || '').split('|');
    var d = Number(parts[3]);
    return { cid: parts[1] && parts[1] !== 'all' && parts[1] !== 'tot' ? parts[1] : null, metric: parts[2] || 'revenue', day: fin(d) ? d : null };
  }
  function AnomalyRow(p) {
    var React = R(), H = hooks(), ins = p.ins;
    var k = parseAnomalyKey(ins.key);
    var args = React.useMemo(function () {
      if (k.day == null) return null;
      var a = { metric: k.metric, fromDay: k.day - 13, toDay: k.day };
      if (k.cid) a.campaignIds = [k.cid];
      return a;
    }, [ins.key]);
    var series = H.useSelect(React.useCallback(function (w) { return args && has(sel(), 'series') ? sel().series(w, args) : EMPTY; }, [args])) || EMPTY;
    var es = React.useState(null), err = es[0], setErr = es[1];
    var SP = chartOr('Sparkline');
    var vals = series.map(function (q) { return q.value; });
    var hi = -1;
    series.forEach(function (q, i) { if (q.day === k.day) hi = i; });
    function dismiss() { var r = dispatch({ type: 'insight/dismiss', payload: { id: ins.id } }); if (!r.ok) setErr(r.error || 'Could not dismiss.'); }
    return html`<li className=${'an-anomaly an-sev-' + (ins.severity || 'warn')}>
      <div className="an-anomaly-text">
        <span className="an-anomaly-title">${ins.title || ins.body}</span>
        ${ins.title && ins.body ? html`<span className="an-muted">${ins.body}</span>` : null}
        <span className="an-meta num">${stamp(ins.tick)}</span>
        ${err ? html`<span className="an-error">${err}</span>` : null}
      </div>
      <div className="an-anomaly-spark">${SP && vals.length > 1 ? html`<${SP} values=${vals} width=${120} height=${32} highlightIndex=${hi >= 0 ? hi : undefined}
          ariaLabel=${metricLabel(k.metric) + ' for 14 days to ' + (k.day != null ? dayShort(k.day) : '') + ', flagged day highlighted'} />` : null}</div>
      <${Btn} kind="ghost" onClick=${dismiss}>Dismiss<//>
    </li>`;
  }
  function AnomaliesSection(p) {
    var React = R(), H = hooks(), f = p.f, ids = f.campaignIds || EMPTY;
    var all = H.useSelect(React.useCallback(function (w) { return has(sel(), 'insights') ? sel().insights(w, { kinds: ['anomaly'] }) : EMPTY; }, [])) || EMPTY;
    var list = React.useMemo(function () {
      if (!ids.length) return all;
      return all.filter(function (x) { return x.entity && ids.indexOf(x.entity.id) >= 0; });
    }, [all, ids]);
    var fz = React.useState(false), focused = fz[0], setFocused = fz[1];
    var frozen = typeof H.useFrozen === 'function' ? H.useFrozen(list, { key: 'id', freeze: focused }) : { items: list, pending: 0, reveal: function () {} };
    var items = frozen.items || list;
    var pending = typeof frozen.pending === 'number' ? frozen.pending : (frozen.pending && frozen.pending.length) || 0;
    var NP = kit('NewItemsPill');
    return html`<${Card} id="analytics-anomalies" title="Anomalies" sub="Days that broke from the expected pattern, flagged by Insight Analyst.">
      ${pending > 0 ? (NP ? html`<${NP} count=${pending} onClick=${frozen.reveal} />`
        : html`<button type="button" className="an-newpill" onClick=${frozen.reveal}>${pending + ' new'}</button>`) : null}
      ${items.length ? html`<ul className="an-anomalies" onFocus=${function () { setFocused(true); }}
          onBlur=${function (e) { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
          ${items.slice(0, 12).map(function (ins) { return html`<${AnomalyRow} key=${ins.id} ins=${ins} />`; })}
        </ul>` : html`<${Empty} title="Nothing unusual so far." body="Insight Analyst checks complete days every 6 hours and flags moves of 3 standard deviations or more." />`}
    <//>`;
  }

  /* ---------------- What-if budget data (memoized per campaign, recomputed daily) ---------------- */
  var wiCache = {};
  function whatIfData(w, cid) {
    var c = w && w.campaigns && w.campaigns.byId[cid];
    if (!c) return null;
    var t = Math.floor(w.meta.tick / 24), days = w.metrics.days;
    var deps = [c, t, days.length, w];
    var e = wiCache[cid];
    if (e && sameItems(e.deps, deps)) return e.value;
    var F = MC.F || { REV: 5, COST: 6 }, D0 = (MC.time && MC.time.DAY0) || -60;
    var lastDay = Math.floor((c.endTick - 1) / 24);
    var daysLeft = (c.status === 'live' || c.status === 'paused') ? Math.max(0, lastDay - Math.max(t, Math.floor(c.startTick / 24)) + 1) : 0;
    var channels = c.channels.map(function (ch) {
      var spentBefore = 0, pts = [];
      for (var i = 0; i < days.length; i++) {
        var d = days[i].day != null ? days[i].day : D0 + i;
        var cd = days[i].c && days[i].c[cid], fx = cd && cd.ch && cd.ch[ch];
        if (!fx || d >= t) continue;
        spentBefore += fx[F.COST];
        if (d >= t - 21 && fx[F.COST] > 0) pts.push({ spend: fx[F.COST], revenue: fx[F.REV] });
      }
      var budget = (c.budget && c.budget.byChannel && c.budget.byChannel[ch]) || 0;
      var cur = null;
      if (has(MC.sim, 'dailyBudget')) { try { cur = MC.sim.dailyBudget(w, cid, ch, t); } catch (er) { cur = null; } }
      if (!fin(cur)) cur = daysLeft > 0 ? Math.max(0, budget - spentBefore) / daysLeft : 0;
      var curve = pts.length ? fitCurve(pts) : null;
      return { ch: ch, budget: budget, spentBefore: spentBefore, current: cur, curve: curve, n: pts.length };
    });
    var value = { cid: cid, name: c.name, status: c.status, daysLeft: daysLeft, budgetByCh: c.budget ? c.budget.byChannel : {}, channels: channels };
    wiCache[cid] = { deps: deps, value: value };
    return value;
  }
  function sliderMax(ch) {
    var m = Math.max(ch.current * 3, ch.curve ? ch.curve.B * 3 : 0, 20);
    var p10 = Math.pow(10, Math.floor(Math.log(m) / Math.LN10));
    return Math.ceil(m / p10) * p10;
  }
  function sliderStep(max) { return max >= 2000 ? 10 : (max >= 200 ? 1 : 0.5); }

  /* ---------------- What-if budget ---------------- */
  function simulate(data, plan) {
    var out = { nowRev: 0, newRev: 0, nowSpend: 0, newSpend: 0, v: 0, fitted: 0, unfitted: [] };
    var L = data.daysLeft;
    data.channels.forEach(function (c) {
      var s = plan[c.ch];
      if (!c.curve) { out.unfitted.push(c.ch); return; }
      out.fitted++;
      out.nowRev += response(c.curve, c.current) * L;
      out.newRev += response(c.curve, s) * L;
      out.nowSpend += c.current * L;
      out.newSpend += s * L;
      out.v += (c.curve.sd || 0) * (c.curve.sd || 0) * L;
    });
    var sd = Math.sqrt(out.v);
    out.lo = Math.max(0, out.newRev - Z80 * sd);
    out.hi = out.newRev + Z80 * sd;
    return out;
  }
  function WhatIf(p) {
    var React = R(), H = hooks(), f = p.f;
    var campaigns = H.useSelect(selCampaigns);
    var candidates = React.useMemo(function () {
      if (!campaigns) return EMPTY;
      return campaigns.order.filter(function (id) { var c = campaigns.byId[id]; return c && (c.status === 'live' || c.status === 'paused'); });
    }, [campaigns]);
    var lc = React.useState(null), localCid = lc[0], setLocalCid = lc[1];
    var pref = f.campaignIds && f.campaignIds.length === 1 && candidates.indexOf(f.campaignIds[0]) >= 0 ? f.campaignIds[0] : null;
    var cid = localCid && candidates.indexOf(localCid) >= 0 ? localCid : (pref || candidates[0] || null);
    var data = H.useSelect(React.useCallback(function (w) { return cid ? whatIfData(w, cid) : null; }, [cid]));
    return html`<${Card} id="analytics-whatif" title="What-if budget" className="an-span-12"
        sub="Move daily spend between channels and see predicted revenue on each channel's fitted response curve. Nothing changes until you apply it."
        actions=${candidates.length > 1 ? html`<div className="an-inline-controls">
            <label className="an-filter-label" htmlFor="analytics-whatif-campaign">Campaign</label>
            <select id="analytics-whatif-campaign" className="an-select" value=${cid || ''} onChange=${function (e) { setLocalCid(e.target.value); }}>
              ${candidates.map(function (id) { return html`<option key=${id} value=${id}>${campaigns.byId[id].name}</option>`; })}
            </select></div>` : null}>
      ${!cid ? html`<${Empty} title="Nothing is live right now." body="What-if works on live or paused campaigns with spend history." />`
        : data ? html`<${WhatIfBody} key=${cid} data=${data} />` : null}
    <//>`;
  }
  function WhatIfBody(p) {
    var React = R(), data = p.data;
    var ds = React.useState(null), draft = ds[0], setDraft = ds[1];
    var cs = React.useState(false), confirming = cs[0], setConfirming = cs[1];
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var plan = {};
    data.channels.forEach(function (c) { plan[c.ch] = draft && fin(draft[c.ch]) ? draft[c.ch] : c.current; });
    var sim = simulate(data, plan);
    var dirty = !!draft && data.channels.some(function (c) { return Math.abs(plan[c.ch] - c.current) > 0.005; });
    var L = data.daysLeft;
    var RC = chartOr('ResponseCurve');
    function setCh(ch, v) {
      setMsg(null); setConfirming(false);
      setDraft(function (prev) { var n = assign({}, plan, prev || {}); n[ch] = v; return n; });
    }
    function bestSplit() {
      var curves = {}, total = 0;
      data.channels.forEach(function (c) { if (c.curve) { curves[c.ch] = c.curve; total += plan[c.ch]; } });
      var opt = optimizeSplit(curves, total);
      if (!opt) return;
      setMsg(null); setConfirming(false);
      setDraft(function (prev) {
        var n = assign({}, plan, prev || {});
        Object.keys(opt).forEach(function (k) { n[k] = Math.round(opt[k] * 100) / 100; });
        return n;
      });
    }
    function byChannel() {
      var out = {};
      Object.keys(data.budgetByCh || {}).sort().forEach(function (ch) { out[ch] = data.budgetByCh[ch]; });
      data.channels.forEach(function (c) { out[c.ch] = Math.max(0, Math.round(c.spentBefore + plan[c.ch] * L)); });
      return out;
    }
    function apply() {
      var r = dispatch({ type: 'campaign/setBudget', payload: { id: data.cid, byChannel: byChannel() } });
      setConfirming(false);
      if (r.ok) { setDraft(null); setMsg({ tone: 'good', text: 'Budget updated for ' + data.name + '. Budget Pacer works from the new totals at its next run.' }); }
      else setMsg({ tone: 'crit', text: r.error || 'The budget change was not applied.' });
    }
    function askPacer() {
      var r = dispatch({ type: 'agent/runNow', payload: { id: 'pacer' } });
      setMsg(r.ok ? { tone: 'agent', text: 'Budget Pacer will review ' + data.name + ' shortly and post any proposal to Approvals.' }
        : { tone: 'crit', text: r.error || 'Could not queue Budget Pacer.' });
    }
    if (L <= 0) return html`<${Empty} title="This campaign has no days left to plan." />`;
    if (!sim.fitted) return html`<${Empty} title="Not enough spend history to fit response curves yet." body="Curves need at least one complete day of spend on a channel." />`;
    var dSpend = (sim.newSpend - sim.nowSpend) / L;
    var nowRoas = sim.nowSpend > 0 ? sim.nowRev / sim.nowSpend : null, newRoas = sim.newSpend > 0 ? sim.newRev / sim.newSpend : null;
    var summary = 'Predicted revenue ' + moneyC(sim.newRev) + ' (' + moneyC(sim.lo) + EN + moneyC(sim.hi) + ') vs ' + moneyC(sim.nowRev) + ' now';
    var bc = byChannel();
    var confirmText = 'Set ' + data.name + ' budgets to ' + data.channels.map(function (c) { return chLabel(c.ch) + ' ' + money(bc[c.ch]); }).join(MID) + '? Agents work from the new totals at their next run.';
    return html`<div className="an-whatif">
      <div className="an-whatif-summary">
        <p className="an-headline"><span className="num">${summary}</span>${MID}Return <span className="num">${ratio(nowRoas) + ARROW + ratio(newRoas)}</span></p>
        <p className="an-muted num">Over the ${L} remaining day${L === 1 ? '' : 's'}${MID}daily spend ${money(sim.nowSpend / L) + ARROW + money(sim.newSpend / L)}
          ${Math.abs(dSpend) >= 1 ? ' (' + (dSpend > 0 ? '+' : '-') + money(Math.abs(dSpend)) + '/day)' : ''}${MID}80% range from curve fit error.</p>
        ${sim.unfitted.length ? html`<p className="an-muted">No spend history yet on ${sim.unfitted.map(chLabel).join(', ')}; ${sim.unfitted.length === 1 ? 'it is' : 'they are'} left out of the prediction.</p>` : null}
      </div>
      <div className="an-curves">
        ${data.channels.map(function (c) {
          var max = sliderMax(c), step = sliderStep(max), val = plan[c.ch], id = 'analytics-whatif-' + c.ch;
          var mNow = c.curve ? marginal(c.curve, val) : null;
          return html`<div key=${c.ch} className="an-curve">
            <div className="an-curve-head">
              <label htmlFor=${id} className="an-curve-label"><span className="an-swatch" style=${{ background: 'var(--' + chColor(c.ch) + ')' }} aria-hidden="true"></span>${chLabel(c.ch)}</label>
              <span className="an-curve-val num">${money(val) + '/day'}</span>
            </div>
            <input id=${id} type="range" className="an-range" min="0" max=${max} step=${step} value=${Math.min(val, max)}
              aria-valuetext=${money(val) + ' per day'} disabled=${!c.curve}
              onChange=${function (e) { setCh(c.ch, Number(e.target.value)); }} />
            <div className="an-curve-meta num">
              <span>Now ${money(c.current)}/day</span>
              <span>${mNow != null ? 'Next $1 returns $' + mNow.toFixed(2) : 'No spend history'}</span>
            </div>
            ${c.curve && RC ? html`<${RC} curve=${c.curve} current=${c.current} proposed=${Math.abs(val - c.current) > 0.005 ? val : undefined}
                maxSpend=${max} height=${140} label=${chLabel(c.ch) + ' response curve'} color=${chColor(c.ch)} />` : null}
            ${c.curve && c.curve.prior ? html`<p className="an-note">Weak fit (r² ${fin(c.curve.r2) ? c.curve.r2.toFixed(2) : DASH}); using a prior curve.</p>` : null}
          </div>`;
        })}
      </div>
      ${confirming ? html`<${Confirm} message=${confirmText} confirmLabel="Apply budget" cancelLabel="Keep editing" onConfirm=${apply} onCancel=${function () { setConfirming(false); }} />`
        : html`<div className="an-actions">
          <${Btn} kind="ghost" onClick=${function () { setDraft(null); setMsg(null); }} disabled=${!draft}>Reset<//>
          <${Btn} kind="secondary" onClick=${bestSplit}>Best split for this spend<//>
          <${Btn} kind="primary" onClick=${function () { setConfirming(true); }} disabled=${!dirty}>Apply to campaign${ELL}<//>
          <${Btn} kind="secondary" onClick=${askPacer}>Ask Budget Pacer to evaluate<//>
        </div>`}
      ${msg ? html`<p className=${'an-msg an-tone-' + msg.tone}>${msg.text}</p>` : null}
    </div>`;
  }

  /* ---------------- Insights (narratives) ---------------- */
  var MONTH_ARGS = { metric: 'revenue', month: true };
  var ANALYST_KINDS = { kinds: ['goal-risk', 'roi', 'pacing'] };
  function goEvidence(patch, target) {
    var sec = SECTION_OF[target];
    patch = Object.assign({}, patch || {}, sec ? { section: sec } : {});
    if (MC.uiStore && MC.uiStore.setFocus) MC.uiStore.setFocus('analytics', patch);
    var id = (target || 'analytics-performance') + '-title';
    setTimeout(function () {
      var el = document.getElementById(id);
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } if (el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }
    }, 0);
  }
  function Narratives(p) {
    var React = R(), H = hooks(), f = p.f;
    var month = H.useSelect(React.useCallback(function (w) { return has(sel(), 'forecast') ? sel().forecast(w, MONTH_ARGS) : null; }, []));
    var chArgs = React.useMemo(function () { return { range: f.range, campaignIds: f.campaignIds }; }, [f]);
    var chans = H.useSelect(React.useCallback(function (w) { return has(sel(), 'channelCompare') ? sel().channelCompare(w, chArgs) : EMPTY; }, [chArgs])) || EMPTY;
    var trendArgs = React.useMemo(function () { return { metric: f.metric, range: 15, campaignIds: f.campaignIds, channel: f.channel }; }, [f]);
    var trend = H.useSelect(React.useCallback(function (w) { return has(sel(), 'series') ? sel().series(w, trendArgs) : EMPTY; }, [trendArgs])) || EMPTY;
    var imp = H.useSelect(React.useCallback(function (w) { return has(sel(), 'agentImpact') ? sel().agentImpact(w) : null; }, []));
    var segs = H.useSelect(React.useCallback(function (w) { return has(sel(), 'segmentRows') ? sel().segmentRows(w) : EMPTY; }, [])) || EMPTY;
    var analyst = H.useSelect(React.useCallback(function (w) { return has(sel(), 'insights') ? sel().insights(w, ANALYST_KINDS) : EMPTY; }, [])) || EMPTY;
    var cards = [];

    if (month && fin(month.goal) && month.cumulative && month.cumulative.projected) {
      var pr = month.cumulative.projected, gap = pr.mean / month.goal - 1;
      cards.push({ id: 'n-month', tone: month.p >= 0.7 ? 'good' : (month.p >= 0.4 ? 'warn' : 'crit'), label: 'Forecast',
        text: (month.month ? month.month.name || month.month.label : 'This month') + ' revenue is on pace for ' + moneyC(pr.mean) + ' (' + moneyC(pr.lo80) + EN + moneyC(pr.hi80) + '), ' +
          pct(Math.abs(gap), 0) + (gap >= 0 ? ' above' : ' below') + ' the ' + moneyC(month.goal) + ' goal' + (fin(month.p) ? ' (' + pct(month.p, 0) + ' chance of hitting it).' : '.'),
        evidence: { label: 'Show revenue trend', patch: { metric: 'revenue', campaignIds: [], channel: 'all' } } });
    }
    var complete = trend.filter(function (q) { return !q.partial; });
    if (complete.length >= 14) {
      var a = aggregate(complete.slice(-7).map(function (q) { return q.value; }), f.metric);
      var b = aggregate(complete.slice(-14, -7).map(function (q) { return q.value; }), f.metric);
      if (fin(a) && fin(b) && b > 0) {
        var r = a / b - 1;
        cards.push({ id: 'n-trend', tone: Math.abs(r) < 0.03 ? 'neutral' : (r > 0 ? 'good' : 'warn'), label: 'Last 7 days',
          text: metricLabel(f.metric) + (Math.abs(r) < 0.03 ? ' held steady at ' : (r > 0 ? ' rose ' + pct(r, 0) + ' to ' : ' fell ' + pct(-r, 0) + ' to ')) +
            metricFmt(f.metric)(a) + (isRatio(f.metric) ? ' on average' : '') + ' over the last 7 complete days, vs ' + metricFmt(f.metric)(b) + ' the week before.',
          evidence: { label: 'Show in chart', patch: {} } });
      }
    }
    var spendCh = chans.filter(function (c) { return fin(c.roas) && c.cost > 0; }).slice().sort(function (x, y) { return (y.roas - x.roas) || (x.ch < y.ch ? -1 : 1); });
    if (spendCh.length >= 2) {
      var hi = spendCh[0], lo = spendCh[spendCh.length - 1];
      cards.push({ id: 'n-channel', tone: 'neutral', label: 'Channels',
        text: (hi.label || chLabel(hi.ch)) + ' returned ' + ratio(hi.roas) + ' on ' + moneyC(hi.cost) + ' of spend ' + rangeLabel(f.range) + ', vs ' + ratio(lo.roas) + ' on ' + (lo.label || chLabel(lo.ch)) + '. Try the what-if planner before moving budget.',
        evidence: { label: 'Compare channels', patch: {}, target: 'analytics-channels' } });
    }
    var rs = segs.filter(function (s) { return fin(s.roas); }).slice().sort(function (x, y) { return (y.roas - x.roas) || (x.id < y.id ? -1 : 1); });
    if (rs.length >= 2) {
      var avg = 0; rs.forEach(function (s) { avg += s.roas; }); avg /= rs.length;
      cards.push({ id: 'n-segment', tone: 'neutral', label: 'Audiences',
        text: rs[0].name + ' returns ' + ratio(rs[0].roas) + ' across its campaigns, ' + ratio(rs[0].roas / avg) + ' the average targeted audience' +
          (fin(rs[0].meanLtv) ? ', with ' + money(rs[0].meanLtv) + ' predicted 12-month value per person.' : '.'),
        evidence: { label: 'Rank audiences', patch: {}, target: 'analytics-audiences' } });
    }
    if (imp && imp.rows && imp.rows.length) {
      var meas = imp.rows.filter(function (x) { return x.status === 'measuring'; }).length;
      cards.push({ id: 'n-agents', tone: 'agent', label: 'Agents',
        text: 'Agents have applied ' + imp.rows.length + ' change' + (imp.rows.length === 1 ? '' : 's') + ': ' + moneySigned(imp.totals.realized) + ' realized against the control group so far, ' +
          moneySigned(imp.totals.expected) + ' expected' + (meas ? ', with ' + meas + ' still measuring.' : '.'),
        evidence: { label: 'See agent impact', patch: {}, target: 'analytics-agent-impact' } });
    }
    analyst.slice(0, 4).forEach(function (ins) {
      var cid = ins.entity && ins.entity.kind === 'campaign' ? ins.entity.id : null;
      cards.push({ id: ins.id, tone: ins.severity === 'crit' ? 'crit' : (ins.severity === 'warn' ? 'warn' : 'agent'), label: 'Insight Analyst', agentId: 'analyst',
        text: ins.title ? ins.title + (ins.body ? ' ' + ins.body : '') : ins.body, insightId: ins.id,
        evidence: cid ? { label: 'Show campaign', patch: { campaignIds: [cid] } } : null });
    });

    function dismiss(id) { dispatch({ type: 'insight/dismiss', payload: { id: id } }); }
    return html`<${Card} id="analytics-insights" title="Insights" sub="Plain-language readouts of the numbers below, refreshed as results come in.">
      ${cards.length ? html`<ul className="an-insights">
          ${cards.map(function (c) {
            return html`<li key=${c.id} className=${'an-insight an-tone-' + c.tone}>
              <span className="an-insight-label">${c.agentId ? html`<${Chip} agentId=${c.agentId} />` : c.label}</span>
              <p className="an-insight-text num">${c.text}</p>
              <span className="an-actions">
                ${c.evidence ? html`<button type="button" className="an-link" onClick=${function () { goEvidence(c.evidence.patch, c.evidence.target); }}>${c.evidence.label}</button>` : null}
                ${c.insightId ? html`<button type="button" className="an-link" onClick=${function () { dismiss(c.insightId); }}>Dismiss</button>` : null}
              </span>
            </li>`;
          })}
        </ul>` : html`<${Empty} title="Insights appear as data comes in." body="The first readouts need a week of complete days." />`}
    <//>`;
  }

  /* ---------------- the view ---------------- */
  // §11.4: the view opens on the performance overview and insights; deeper analysis sits behind tabs.
  var SECTIONS = [
    { id: 'channels', label: 'Channels' },
    { id: 'impact', label: 'Agent impact' },
    { id: 'anomalies', label: 'Anomalies' },
    { id: 'attribution', label: 'Attribution' },
    { id: 'audiences', label: 'Audiences' },
    { id: 'whatif', label: 'What-if budget' }
  ];
  var SECTION_OF = { 'analytics-channels': 'channels', 'analytics-funnel': 'channels', 'analytics-agent-impact': 'impact',
    'analytics-anomalies': 'anomalies', 'analytics-attribution': 'attribution', 'analytics-audiences': 'audiences', 'analytics-whatif': 'whatif' };
  function sectionBody(id, f) {
    if (id === 'impact') return html`<${AgentImpact} f=${f} />`;
    if (id === 'anomalies') return html`<${AnomaliesSection} f=${f} />`;
    if (id === 'attribution') return html`<${AttributionSection} f=${f} />`;
    if (id === 'audiences') return html`<${AudienceSection} />`;
    if (id === 'whatif') return html`<${WhatIf} f=${f} />`;
    return html`<div className="an-grid an-grid-inner">
      <div className="an-cell an-span-7"><${ChannelsSection} f=${f} /></div>
      <div className="an-cell an-span-5"><${FunnelSection} f=${f} /></div>
    </div>`;
  }
  function MoreAnalysis(p) {
    var Tabs = MC.ui && typeof MC.ui.Tabs === 'function' ? MC.ui.Tabs : null;
    var cur = SECTIONS.some(function (x) { return x.id === p.section; }) ? p.section : 'channels';
    function pick(id) { if (MC.uiStore && MC.uiStore.setFocus) MC.uiStore.setFocus('analytics', { section: id }); }
    return html`<section className="an-more" aria-labelledby="analytics-more-title">
      <h2 id="analytics-more-title" className="an-more-title">Deeper analysis</h2>
      ${Tabs ? html`<${Tabs} id="analytics-sections" label="Deeper analysis" tabs=${SECTIONS} value=${cur} onChange=${pick} panelId="analytics-section-panel" />`
        : html`<div className="an-more-tabs" role="group" aria-label="Deeper analysis">${SECTIONS.map(function (x) {
            return html`<button key=${x.id} type="button" className=${'an-link' + (x.id === cur ? ' is-on' : '')} aria-pressed=${x.id === cur ? 'true' : 'false'}
              onClick=${function () { pick(x.id); }}>${x.label}</button>`;
          })}</div>`}
      <div id="analytics-section-panel" role="tabpanel" aria-labelledby=${'analytics-sections-' + cur} className="an-more-panel">${sectionBody(cur, p.f)}</div>
    </section>`;
  }
  var DEFAULT_FOCUS = { range: 30, campaignIds: [], channel: 'all', metric: 'revenue', showAgents: true };
  function selFocus(s) { return s && s.focus ? s.focus.analytics : undefined; }
  function selReady(w) { return !!(w && w.meta); }
  function AsOf() {
    var tick = hooks().useSelect(selTick);
    var f = tm('dateLabel'), tl = tm('timeLabel');
    var when = fin(tick) && f && tl ? f(tick) + ', ' + tl(tick) : stamp(tick);
    return html`<p className="an-asof">Fernway Outfitters${MID}<span className="num">through ${when}</span></p>`;
  }
  function AnalyticsView() {
    var React = R(), H = hooks();
    var ready = H.useSelect(selReady);
    var raw = H.useUi(selFocus) || DEFAULT_FOCUS;
    var campaigns = H.useSelect(selCampaigns);
    var focus = React.useMemo(function () {
      var r = raw.range === 'all' ? 'all' : ([14, 30, 60].indexOf(Number(raw.range)) >= 0 ? Number(raw.range) : 30);
      var ids = (raw.campaignIds || EMPTY).filter(function (id) { return campaigns && campaigns.byId[id]; });
      var metric = raw.metric && (METRICS.some(function (m) { return m.value === raw.metric; }) || EXTRA_METRICS[raw.metric]) ? raw.metric : 'revenue';
      var ch = raw.channel && (raw.channel === 'all' || CH().ALL.indexOf(raw.channel) >= 0) ? raw.channel : 'all';
      return { range: r, campaignIds: ids, channel: ch, metric: metric, showAgents: raw.showAgents !== false, section: raw.section || 'channels' };
    }, [raw, campaigns]);
    var idsKey = focus.campaignIds.join(',');
    var f = React.useMemo(function () {
      return { metric: focus.metric, range: focus.range, campaignIds: focus.campaignIds, channel: focus.channel };
    }, [focus.metric, focus.range, idsKey, focus.channel]);
    var list = React.useMemo(function () {
      if (!campaigns) return EMPTY;
      return campaigns.order.map(function (id) { return campaigns.byId[id]; })
        .filter(function (c) { return c && c.status !== 'draft'; })
        .map(function (c) { return { id: c.id, name: c.name, status: c.status }; });
    }, [campaigns]);
    if (!ready) {
      return html`<section className="v-analytics"><h1 id="page-title" tabIndex="-1" className="an-h1">Analytics</h1>
        <p className="an-muted">Loading Fernway Outfitters${ELL}</p></section>`;
    }
    return html`<section className="v-analytics">
      <header className="an-pagehead">
        <h1 id="page-title" tabIndex="-1" className="an-h1">Analytics</h1>
        <${AsOf} />
      </header>
      <${FilterBar} focus=${focus} campaigns=${list} />
      <div className="an-grid">
        <div className="an-cell an-span-12"><${Performance} f=${f} showAgents=${focus.showAgents} /></div>
        <div className="an-cell an-span-12"><${Narratives} f=${f} /></div>
      </div>
      <${MoreAnalysis} section=${focus.section} f=${f} />
    </section>`;
  }

  /* Pure helpers exposed for reuse and checks (no state, deterministic). */
  AnalyticsView.helpers = { fitCurve: fitCurve, response: response, marginal: marginal, optimizeSplit: optimizeSplit,
    ewmaFlags: ewmaFlags, simulate: simulate, whatIfData: whatIfData };
  MC.views.analytics = AnalyticsView;
})();
