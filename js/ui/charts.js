/* Marketing Cloud - hand-written SVG charts (MC.charts.*, ch- classes).
   Colors come only from CSS custom properties (tokens.css). Every chart is safe on
   empty / NaN input, sizes from its container width, carries role="img" with an
   aria-label summary, and (except Sparkline / ScoreRing) offers "View as table". */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.charts = MC.charts || {};

  var DASH = '–';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function html() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /* ---------- formatting (MC.fmt when present, locale-free fallbacks) ---------- */
  function commas(n) {
    var s = String(Math.round(Math.abs(n)));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function compact(n) {
    var a = Math.abs(n), sg = n < 0 ? '-' : '';
    if (a >= 1e6) return sg + trimZ((a / 1e6).toFixed(1)) + 'M';
    if (a >= 1e4) return sg + trimZ((a / 1e3).toFixed(1)) + 'k';
    return sg + commas(a);
  }
  function trimZ(s) { return s.replace(/\.0$/, ''); }
  function localNum(n) {
    if (!fin(n)) return DASH;
    if (Math.abs(n) >= 100) return (n < 0 ? '-' : '') + commas(n);
    if (Math.abs(n) >= 10) return trimZ(n.toFixed(1));
    return String(Math.round(n * 100) / 100);
  }
  function callFmt(name, n, opt) {
    try {
      if (MC.fmt && typeof MC.fmt[name] === 'function') return MC.fmt[name](n, opt);
    } catch (e) { /* fall through to local formatting */ }
    return null;
  }
  var FORMATS = {
    num: function (n) { var r = callFmt('num', n); return r != null ? r : localNum(n); },
    compact: function (n) { var r = callFmt('num', n, { compact: true }); return r != null ? r : compact(n); },
    money: function (n) { var r = callFmt('money', n); return r != null ? r : (n < 0 ? '-$' : '$') + commas(n); },
    moneyCompact: function (n) { var r = callFmt('money', n, { compact: true }); return r != null ? r : (n < 0 ? '-$' : '$') + compact(Math.abs(n)); },
    pct: function (n) { var r = callFmt('pct', n); return r != null ? r : trimZ((n * 100).toFixed(1)) + '%'; },
    ratio: function (n) { var r = callFmt('ratio', n); return r != null ? r : n.toFixed(1) + '×'; },
    int: function (n) { return (n < 0 ? '-' : '') + commas(n); }
  };
  FORMATS['money-compact'] = FORMATS.moneyCompact;
  function resolveFmt(f, fallback) {
    var base = typeof f === 'function' ? f : (FORMATS[f] || fallback || FORMATS.num);
    return function (n) {
      if (!fin(n)) return DASH;
      try { var s = base(n); return s == null ? DASH : String(s); } catch (e) { return localNum(n); }
    };
  }

  /* ---------- calendar arithmetic (sim day 0 = Sat 2026-11-07; no Date) ---------- */
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function yearLen(y) { return isLeap(y) ? 366 : 365; }
  function calDay(d) {
    var n = Math.floor(d) + 310, y = 2026, guard = 0;
    while (n < 0 && guard++ < 50) { y--; n += yearLen(y); }
    while (n >= yearLen(y) && guard++ < 100) { n -= yearLen(y); y++; }
    var ml = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], m = 0;
    while (m < 11 && n >= ml[m]) { n -= ml[m]; m++; }
    return { y: y, m: m, d: n + 1 };
  }
  function shortDay(d) {
    if (!fin(d)) return DASH;
    if (window.MC && MC.time && typeof MC.time.dayLabel === 'function') return MC.time.dayLabel(d, { style: 'short' });
    var c = calDay(d);
    return MONTHS[c.m] + ' ' + c.d;
  }
  function hourLabel(h) {
    var r = callFmt('hour', h);
    if (r != null) return r;
    h = ((Math.round(h) % 24) + 24) % 24;
    if (h === 0) return '12 am';
    if (h === 12) return '12 pm';
    return h < 12 ? h + ' am' : (h - 12) + ' pm';
  }

  /* ---------- scales and ticks ---------- */
  function linScale(d0, d1, r0, r1) {
    if (!fin(d0) || !fin(d1) || d1 === d0) {
      var mid = (r0 + r1) / 2;
      return function () { return mid; };
    }
    var k = (r1 - r0) / (d1 - d0);
    return function (v) { return r0 + (v - d0) * k; };
  }
  function niceStep(span, count) {
    var raw = span / Math.max(1, count);
    if (!(raw > 0) || !isFinite(raw)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var e = raw / p;
    var m = e >= 7.5 ? 10 : (e >= 3.5 ? 5 : (e >= 1.5 ? 2 : 1));
    return m * p;
  }
  function niceTicks(lo, hi, count) {
    if (!fin(lo) || !fin(hi)) { lo = 0; hi = 1; }
    if (hi < lo) { var t0 = lo; lo = hi; hi = t0; }
    if (hi === lo) {
      if (hi === 0) hi = 1;
      else { var pad = Math.abs(hi) * 0.1; lo -= pad; hi += pad; }
    }
    var st = niceStep(hi - lo, count || 5);
    var a = Math.floor(lo / st + 1e-9) * st, b = Math.ceil(hi / st - 1e-9) * st;
    var ticks = [];
    for (var i = 0; a + i * st <= b + st * 1e-6 && i < 60; i++) {
      ticks.push(Math.round((a + i * st) / st) * st);
    }
    return { lo: a, hi: b, ticks: ticks, step: st };
  }
  function extent(vals) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (fin(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    return lo === Infinity ? null : [lo, hi];
  }
  function nearest(sorted, v) {
    if (!sorted.length) return null;
    var lo = 0, hi = sorted.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid; else hi = mid;
    }
    return Math.abs(sorted[lo] - v) <= Math.abs(sorted[hi] - v) ? sorted[lo] : sorted[hi];
  }
  /* Path through points, broken at non-finite values. pts = [[x,y]|null] */
  function linePath(pts) {
    var d = '', pen = false;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p || !fin(p[0]) || !fin(p[1])) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + r2(p[0]) + ' ' + r2(p[1]);
      pen = true;
    }
    return d;
  }
  /* Closed band between upper and lower point lists (same x order). */
  function bandPath(up, dn) {
    var u = [], l = [];
    for (var i = 0; i < up.length; i++) {
      if (up[i] && dn[i] && fin(up[i][0]) && fin(up[i][1]) && fin(dn[i][1])) { u.push(up[i]); l.push(dn[i]); }
    }
    if (u.length < 2) return '';
    var d = 'M' + r2(u[0][0]) + ' ' + r2(u[0][1]);
    for (var j = 1; j < u.length; j++) d += 'L' + r2(u[j][0]) + ' ' + r2(u[j][1]);
    for (var k = l.length - 1; k >= 0; k--) d += 'L' + r2(l[k][0]) + ' ' + r2(l[k][1]);
    return d + 'Z';
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  /* Bar with a 4px rounded data end and a square baseline end. */
  function barPathH(x0, x1, y, h, rad) {
    var w = Math.abs(x1 - x0);
    if (w < 0.5) return '';
    var r = Math.min(rad, w, h / 2), dir = x1 >= x0 ? 1 : -1, xe = x1;
    return 'M' + r2(x0) + ' ' + r2(y) + 'L' + r2(xe - dir * r) + ' ' + r2(y) +
      'Q' + r2(xe) + ' ' + r2(y) + ' ' + r2(xe) + ' ' + r2(y + r) +
      'L' + r2(xe) + ' ' + r2(y + h - r) + 'Q' + r2(xe) + ' ' + r2(y + h) + ' ' + r2(xe - dir * r) + ' ' + r2(y + h) +
      'L' + r2(x0) + ' ' + r2(y + h) + 'Z';
  }
  function barPathV(y0, y1, x, w, rad) {
    var h = Math.abs(y1 - y0);
    if (h < 0.5) return '';
    var r = Math.min(rad, h, w / 2), dir = y1 <= y0 ? -1 : 1, ye = y1;
    return 'M' + r2(x) + ' ' + r2(y0) + 'L' + r2(x) + ' ' + r2(ye - dir * r) +
      'Q' + r2(x) + ' ' + r2(ye) + ' ' + r2(x + r) + ' ' + r2(ye) +
      'L' + r2(x + w - r) + ' ' + r2(ye) + 'Q' + r2(x + w) + ' ' + r2(ye) + ' ' + r2(x + w) + ' ' + r2(ye - dir * r) +
      'L' + r2(x + w) + ' ' + r2(y0) + 'Z';
  }
  /* Token color: 'chart-2' | '--chart-2' | 'var(--x)' | index fallback. Never a literal. */
  function tokenColor(c, i) {
    if (typeof c === 'string' && c) {
      if (c.indexOf('var(') === 0) return c;
      if (c.indexOf('--') === 0) return 'var(' + c + ')';
      if (/^[a-z][a-z0-9-]*$/.test(c)) return 'var(--' + c + ')';
    }
    var n = ((((i || 0) % 6) + 6) % 6) + 1;
    return 'var(--chart-' + n + ')';
  }
  function truncate(s, maxChars) {
    s = s == null ? '' : String(s);
    if (maxChars < 2) return '';
    return s.length > maxChars ? s.slice(0, Math.max(1, maxChars - 1)) + '…' : s;
  }
  function textW(s, px) { return String(s == null ? '' : s).length * (px || 11) * 0.58; }

  /* ---------- shared styles (tokens only) ---------- */
  var S = {
    axis: { fill: 'var(--ink-3)', fontSize: 11 },
    axisStrong: { fill: 'var(--ink-2)', fontSize: 11 },
    grid: { stroke: 'var(--chart-grid)' },
    base: { stroke: 'var(--line-strong)' },
    head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6, minWidth: 0 },
    toggle: { font: 'inherit', fontSize: 12, color: 'var(--accent)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', minHeight: 28, cursor: 'pointer', marginLeft: 'auto' },
    tip: { position: 'absolute', pointerEvents: 'none', zIndex: 5, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: 6, boxShadow: 'var(--shadow-pop)', padding: '6px 10px', fontSize: 12, lineHeight: 1.45, whiteSpace: 'nowrap' },
    empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 13, border: '1px dashed var(--line)', borderRadius: 6, background: 'var(--surface-2)', textAlign: 'center', padding: 12 },
    svg: { display: 'block', width: '100%', height: 'auto', overflow: 'visible' }
  };

  /* ---------- width hook: kit's useWidth when present, else a local ResizeObserver ---------- */
  function useLocalWidth(ref) {
    var React = R();
    var st = React.useState(0), w = st[0], setW = st[1];
    React.useLayoutEffect(function () {
      var el = ref.current;
      if (!el) return undefined;
      setW(Math.floor(el.clientWidth));
      if (typeof ResizeObserver === 'undefined') {
        var on = function () { setW(Math.floor(el.clientWidth)); };
        window.addEventListener('resize', on);
        return function () { window.removeEventListener('resize', on); };
      }
      var ro = new ResizeObserver(function (entries) {
        var nw = Math.floor(entries[0].contentRect.width);
        setW(function (p) { return p === nw ? p : nw; });
      });
      ro.observe(el);
      return function () { ro.disconnect(); };
    }, []);
    return w;
  }
  function useChartWidth(ref) {
    var f = MC.hooks && MC.hooks.useWidth;
    var w = typeof f === 'function' ? f(ref) : useLocalWidth(ref);
    return fin(w) ? w : 0;
  }

  /* ---------- Legend ---------- */
  function Legend(p) {
    var items = (p.items || []).filter(Boolean);
    if (!items.length) return null;
    return html`<ul className="ch-legend" aria-label="Legend" style=${{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--ink-2)', minWidth: 0 }}>
      ${items.map(function (it, i) {
        var col = tokenColor(it.color, i);
        var key = it.key != null ? it.key : (it.label || String(i));
        var sw = it.kind === 'band'
          ? html`<span aria-hidden="true" style=${{ display: 'inline-block', width: 14, height: 10, borderRadius: 2, background: 'var(--chart-band)' }}></span>`
          : it.kind === 'line'
            ? html`<svg aria-hidden="true" width="16" height="10" style=${{ display: 'block' }}><line x1="1" y1="5" x2="15" y2="5" strokeWidth="2" strokeLinecap="round" strokeDasharray=${it.dashed ? '4 3' : null} style=${{ stroke: col }} /></svg>`
            : html`<span aria-hidden="true" style=${{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: col }}></span>`;
        return html`<li key=${key} style=${{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>${sw}<span style=${{ overflowWrap: 'anywhere' }}>${it.label}</span></li>`;
      })}
    </ul>`;
  }

  /* ---------- table view ---------- */
  function TableView(p) {
    var t = p.table || {};
    var cols = t.columns || [], rows = t.rows || [];
    if (!rows.length) return html`<div style=${S.empty}>No data to show yet.</div>`;
    var th = { textAlign: 'left', fontWeight: 600, color: 'var(--ink-2)', padding: '6px 8px', borderBottom: '1px solid var(--line-strong)', whiteSpace: 'nowrap' };
    var td = { padding: '5px 8px', borderBottom: '1px solid var(--line)', color: 'var(--ink)' };
    return html`<div className="ch-table-wrap k-scroll-x" style=${{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
      <table className="ch-table num" style=${{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        ${p.caption ? html`<caption style=${{ textAlign: 'left', color: 'var(--ink-3)', fontSize: 12, padding: '0 0 6px' }}>${p.caption}</caption>` : null}
        <thead><tr>${cols.map(function (c) {
          return html`<th key=${c.key} scope="col" style=${Object.assign({}, th, { textAlign: c.align || (c.key === cols[0].key ? 'left' : 'right') })}>${c.label}</th>`;
        })}</tr></thead>
        <tbody>${rows.map(function (r, i) {
          return html`<tr key=${r._key != null ? r._key : i}>${cols.map(function (c, j) {
            return j === 0
              ? html`<th key=${c.key} scope="row" style=${Object.assign({}, td, { fontWeight: 500, textAlign: 'left' })}>${r[c.key]}</th>`
              : html`<td key=${c.key} style=${Object.assign({}, td, { textAlign: c.align || 'right' })}>${r[c.key]}</td>`;
          })}</tr>`;
        })}</tbody>
      </table>
    </div>`;
  }

  /* ---------- frame: legend row, table toggle, measured body ---------- */
  function ChartFrame(p) {
    var React = R();
    var st = React.useState(false), showTable = st[0], setShow = st[1];
    var ref = React.useRef(null);
    var w = useChartWidth(ref);
    var width = w > 0 ? w : (p.fallbackWidth || 320);
    var hasLegend = p.legend && p.legend.length;
    var canTable = p.table && !p.noTable;
    var head = (hasLegend || canTable) ? html`<div className="ch-head" style=${S.head}>
        ${hasLegend ? html`<${Legend} items=${p.legend} />` : html`<span></span>`}
        ${canTable ? html`<button type="button" className="ch-toggle" aria-pressed=${showTable ? 'true' : 'false'} onClick=${function () { setShow(!showTable); }} style=${S.toggle}>${showTable ? 'View as chart' : 'View as table'}</button>` : null}
      </div>` : null;
    return html`<div className=${'ch ' + (p.className || '')} style=${{ position: 'relative', minWidth: 0, width: '100%' }}>
      ${head}
      <div ref=${ref} className="ch-body" style=${{ position: 'relative', minWidth: 0, width: '100%' }}>
        ${showTable ? html`<${TableView} table=${p.table} caption=${p.ariaLabel} />` : p.render(width)}
      </div>
    </div>`;
  }

  function EmptyChart(p) {
    return html`<div className="ch-empty" role="img" aria-label=${p.text} style=${Object.assign({}, S.empty, { minHeight: p.height || 120 })}>${p.text}</div>`;
  }

  /* Tooltip: HTML box positioned in body pixel space; flips left past the midpoint. */
  function Tip(p) {
    if (!p.show) return null;
    var flip = p.x > p.width * 0.55;
    var style = Object.assign({}, S.tip, {
      top: Math.max(0, p.y),
      left: flip ? undefined : clamp(p.x + 12, 0, Math.max(0, p.width - 40)),
      right: flip ? Math.max(0, p.width - p.x + 12) : undefined
    });
    return html`<div className="ch-tip" style=${style}>${p.children}</div>`;
  }
  function TipRow(p) {
    return html`<div style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
      ${p.color ? html`<span aria-hidden="true" style=${{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }}></span>` : null}
      <span style=${{ color: 'var(--ink-2)' }}>${p.label}</span>
      <span style=${{ marginLeft: 'auto', paddingLeft: 12, fontWeight: 600 }}>${p.value}</span>
    </div>`;
  }
  function svgPoint(evt, svgEl, W) {
    if (!svgEl) return null;
    var rect = svgEl.getBoundingClientRect();
    if (!rect.width) return null;
    var k = W / rect.width;
    return { x: (evt.clientX - rect.left) * k, y: (evt.clientY - rect.top) * k, k: k };
  }

  /* ================= Sparkline ================= */
  function Sparkline(p) {
    var W = fin(p.width) ? p.width : 96, Hh = fin(p.height) ? p.height : 24;
    var vals = (p.values || []).map(function (v) { return fin(v) ? v : null; });
    var ex = extent(vals);
    var col = tokenColor(p.color || 'chart-1', 0);
    var label = p.ariaLabel || (ex ? 'Trend, ' + vals.length + ' points, latest ' + localNum(lastFinite(vals)) : 'Trend: no data yet');
    var box = { display: 'block', maxWidth: '100%' };
    if (!ex || vals.length < 2) {
      return html`<svg className="ch-spark" role="img" aria-label=${label} width=${W} height=${Hh} viewBox=${'0 0 ' + W + ' ' + Hh} style=${box}>
        <line x1="0" x2=${W} y1=${Hh / 2} y2=${Hh / 2} strokeWidth="1" strokeDasharray="2 3" style=${S.base} />
      </svg>`;
    }
    var pad = 3, lo = ex[0], hi = ex[1];
    if (p.zero && lo > 0) lo = 0;
    var sx = linScale(0, vals.length - 1, pad, W - pad), sy = linScale(lo, hi, Hh - pad, pad);
    if (hi === lo) sy = function () { return Hh / 2; };
    var pts = vals.map(function (v, i) { return v == null ? null : [sx(i), sy(v)]; });
    var d = linePath(pts);
    var area = null;
    if (p.area) {
      var up = [], dn = [];
      pts.forEach(function (q) { if (q) { up.push(q); dn.push([q[0], Hh - 1]); } });
      area = bandPath(up, dn);
    }
    var li = lastIndex(vals);
    var hiIdx = fin(p.highlightIndex) && vals[p.highlightIndex] != null ? p.highlightIndex : -1;
    return html`<svg className="ch-spark" role="img" aria-label=${label} width=${W} height=${Hh} viewBox=${'0 0 ' + W + ' ' + Hh} style=${box}>
      ${area ? html`<path d=${area} style=${{ fill: col, fillOpacity: 0.12, stroke: 'none' }} />` : null}
      <path d=${d} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style=${{ stroke: col }} />
      ${li >= 0 ? html`<circle cx=${pts[li][0]} cy=${pts[li][1]} r="2.5" strokeWidth="1.5" style=${{ fill: col, stroke: 'var(--surface)' }} />` : null}
      ${hiIdx >= 0 ? html`<path d=${diamond(pts[hiIdx][0], pts[hiIdx][1], 4)} strokeWidth="1.5" style=${{ fill: 'var(--crit)', stroke: 'var(--surface)' }} />` : null}
    </svg>`;
  }
  function lastIndex(vals) { for (var i = vals.length - 1; i >= 0; i--) if (vals[i] != null && fin(vals[i])) return i; return -1; }
  function lastFinite(vals) { var i = lastIndex(vals); return i >= 0 ? vals[i] : NaN; }
  function diamond(x, y, r) { return 'M' + r2(x) + ' ' + r2(y - r) + 'L' + r2(x + r) + ' ' + r2(y) + 'L' + r2(x) + ' ' + r2(y + r) + 'L' + r2(x - r) + ' ' + r2(y) + 'Z'; }

  /* ================= ScoreRing (gauge) ================= */
  function ScoreRing(p) {
    var size = fin(p.size) ? p.size : 40;
    var v = fin(p.value) ? clamp(p.value, 0, 100) : null;
    var sw = Math.max(3, Math.round(size * 0.11)), r = (size - sw) / 2, c = size / 2;
    var circ = 2 * Math.PI * r;
    var label = (p.label || 'Predicted engagement') + ': ' + (v == null ? 'not scored yet' : Math.round(v) + ' of 100');
    return html`<svg className="ch-ring" role="img" aria-label=${label} width=${size} height=${size} viewBox=${'0 0 ' + size + ' ' + size} style=${{ display: 'block', flex: 'none' }}>
      <circle cx=${c} cy=${c} r=${r} fill="none" strokeWidth=${sw} style=${{ stroke: 'var(--line)' }} />
      ${v != null && v > 0 ? html`<circle cx=${c} cy=${c} r=${r} fill="none" strokeWidth=${sw} strokeLinecap="round"
          strokeDasharray=${r2(circ * v / 100) + ' ' + r2(circ)} transform=${'rotate(-90 ' + c + ' ' + c + ')'} style=${{ stroke: 'var(--accent)' }} />` : null}
      <text x=${c} y=${c} textAnchor="middle" dominantBaseline="central" style=${{ fill: 'var(--ink)', fontSize: Math.max(10, Math.round(size * 0.32)), fontWeight: 600 }}>${v == null ? DASH : Math.round(v)}</text>
    </svg>`;
  }

  /* ================= LineChart ================= */
  function xTicksFor(d0, d1, plotW) {
    var count = Math.max(2, Math.floor(plotW / 84));
    var st = Math.max(1, Math.round(niceStep(d1 - d0, count)));
    var out = [], start = Math.ceil(d0 / st) * st;
    for (var v = start; v <= d1 + 1e-9 && out.length < 40; v += st) out.push(v);
    return out;
  }
  function bandPts(b) {
    return (b && b.points ? b.points : []).filter(function (q) { return q && fin(q.x); });
  }

  function LineChart(p) {
    var React = R();
    var hs = React.useState(null), hx = hs[0], setHx = hs[1];
    var svgRef = React.useRef(null);
    var H = fin(p.height) ? p.height : 240;
    var xf = p.xFormat ? resolveFmt(p.xFormat) : shortDay;
    var yf = resolveFmt(p.yFormat, FORMATS.num);
    var series = (p.series || []).filter(function (s) { return s && Array.isArray(s.points); });
    var band = bandPts(p.band), band95 = bandPts(p.band95);
    var markers = (p.markers || []).filter(function (m) { return m && fin(m.x); });

    var seen = {}, xs = [], ys = [], nY = 0;
    var maps = series.map(function (s) {
      var m = {};
      s.points.forEach(function (pt) {
        if (!pt || !fin(pt.x)) return;
        if (!seen[pt.x]) { seen[pt.x] = 1; xs.push(pt.x); }
        if (fin(pt.y)) { ys.push(pt.y); m[pt.x] = pt.y; nY++; }
      });
      return m;
    });
    var bandMap = {};
    [band95, band].forEach(function (b, bi) {
      b.forEach(function (q) {
        if (!seen[q.x]) { seen[q.x] = 1; xs.push(q.x); }
        if (fin(q.lo)) ys.push(q.lo);
        if (fin(q.hi)) ys.push(q.hi);
        if (bi === 1) bandMap[q.x] = q;
      });
    });
    var goal = p.goal && fin(p.goal.y) ? p.goal : null;
    if (goal) ys.push(goal.y);
    xs.sort(function (a, b) { return a - b; });

    var lastS = series[0], lastX = null, lastY = null;
    if (lastS) {
      for (var i = xs.length - 1; i >= 0; i--) {
        if (maps[0][xs[i]] != null) { lastX = xs[i]; lastY = maps[0][xs[i]]; break; }
      }
    }
    var ariaLabel = p.ariaLabel || ((lastS ? (lastS.label || 'Series') : 'Chart') +
      (lastX != null ? ': latest ' + yf(lastY) + ' on ' + xf(lastX) : ': no data'));

    var legend = [];
    if (series.length >= 2 || band.length || band95.length) {
      series.forEach(function (s, si) { legend.push({ key: 's-' + (s.id || si), label: s.label || 'Series ' + (si + 1), color: tokenColor(s.color, si), kind: 'line', dashed: s.dashed }); });
      if (band.length) legend.push({ key: 'band80', label: p.bandLabel || '80% range', kind: 'band' });
      if (band95.length) legend.push({ key: 'band95', label: '95% range', kind: 'band' });
    }
    var table = {
      columns: [{ key: 'x', label: p.xLabel || 'Day', align: 'left' }].concat(series.map(function (s, si) {
        return { key: 's' + si, label: s.label || 'Series ' + (si + 1) };
      })).concat(band.length ? [{ key: 'lo', label: 'Low (80%)' }, { key: 'hi', label: 'High (80%)' }] : []),
      rows: xs.map(function (x) {
        var r = { _key: String(x), x: xf(x) };
        series.forEach(function (s, si) { r['s' + si] = maps[si][x] != null ? yf(maps[si][x]) : DASH; });
        if (band.length) { var q = bandMap[x]; r.lo = q ? yf(q.lo) : DASH; r.hi = q ? yf(q.hi) : DASH; }
        return r;
      })
    };

    if (!nY) {
      return html`<${ChartFrame} className="ch-line" ariaLabel=${ariaLabel} table=${null}
        render=${function () { return html`<${EmptyChart} height=${H} text=${p.emptyText || 'No data in this range yet.'} />`; }} />`;
    }

    function render(W) {
      var ex = extent(ys), lo = ex[0], hi = ex[1];
      if (p.yZero !== false && lo > 0) lo = 0;
      var yt = niceTicks(lo, hi, H < 180 ? 3 : 5);
      var yLabels = yt.ticks.map(yf);
      var ml = clamp(Math.max.apply(null, yLabels.map(function (s) { return textW(s, 11); })) + 10, 30, W * 0.3);
      var hasRail = markers.some(function (m) { return m.kind === 'agent'; });
      var mt = 14, mr = 14, mb = 24 + (hasRail ? 22 : 0);
      var x0 = ml, x1 = Math.max(ml + 20, W - mr), y0 = mt, y1 = H - mb;
      var xd0 = xs[0], xd1 = xs[xs.length - 1];
      if (xd0 === xd1) { xd0 -= 1; xd1 += 1; }
      var sx = linScale(xd0, xd1, x0, x1), sy = linScale(yt.lo, yt.hi, y1, y0);
      var xt = xTicksFor(xd0, xd1, x1 - x0);

      function onMove(e) {
        var pt = svgPoint(e, svgRef.current, W);
        if (!pt || pt.x < x0 - 12 || pt.x > x1 + 12 || pt.y > y1 + 4) return;
        var v = xd0 + (pt.x - x0) / (x1 - x0) * (xd1 - xd0);
        var nx = nearest(xs, v);
        if (nx !== hx) setHx(nx);
      }
      function onKey(e) {
        var idx = hx == null ? xs.length - 1 : xs.indexOf(hx);
        if (e.key === 'ArrowLeft') idx = Math.max(0, idx - 1);
        else if (e.key === 'ArrowRight') idx = Math.min(xs.length - 1, idx + 1);
        else if (e.key === 'Home') idx = 0;
        else if (e.key === 'End') idx = xs.length - 1;
        else if (e.key === 'Escape') { setHx(null); return; }
        else return;
        e.preventDefault();
        setHx(xs[idx]);
      }

      var bandUp = band.map(function (q) { return [sx(q.x), sy(q.hi)]; }), bandDn = band.map(function (q) { return [sx(q.x), sy(q.lo)]; });
      var b95Up = band95.map(function (q) { return [sx(q.x), sy(q.hi)]; }), b95Dn = band95.map(function (q) { return [sx(q.x), sy(q.lo)]; });
      var showHover = hx != null && seen[hx];
      var hpx = showHover ? sx(hx) : 0;
      var railY = H - 10;
      var evK = 0;

      var svg = html`<svg ref=${svgRef} role="group" aria-label=${ariaLabel} viewBox=${'0 0 ' + W + ' ' + H} width=${W} height=${H} style=${S.svg}
          onPointerMove=${onMove} onPointerLeave=${function () { setHx(null); }}>
        <title>${ariaLabel}</title>
        ${yt.ticks.map(function (t, k) {
          var y = sy(t);
          return html`<g key=${'y' + k}>
            <line x1=${x0} x2=${x1} y1=${y} y2=${y} strokeWidth="1" style=${k === 0 && t === 0 ? S.base : S.grid} />
            <text x=${x0 - 6} y=${y} textAnchor="end" dominantBaseline="central" style=${S.axis}>${yLabels[k]}</text>
          </g>`;
        })}
        ${xt.map(function (t, k) {
          return html`<text key=${'x' + k} x=${sx(t)} y=${y1 + 16} textAnchor=${k === 0 && sx(t) - x0 < 20 ? 'start' : 'middle'} style=${S.axis}>${xf(t)}</text>`;
        })}
        ${b95Up.length > 1 ? html`<path d=${bandPath(b95Up, b95Dn)} style=${{ fill: 'var(--chart-band)', fillOpacity: 0.55, stroke: 'none' }} />` : null}
        ${bandUp.length > 1 ? html`<path d=${bandPath(bandUp, bandDn)} style=${{ fill: 'var(--chart-band)', stroke: 'none' }} />` : null}
        ${fin(p.forecastFrom) && p.forecastFrom >= xd0 && p.forecastFrom <= xd1 ? html`<g>
            <line x1=${sx(p.forecastFrom)} x2=${sx(p.forecastFrom)} y1=${y0} y2=${y1} strokeWidth="1" strokeDasharray="3 3" style=${{ stroke: 'var(--ink-3)' }} />
            <text x=${sx(p.forecastFrom) + (sx(p.forecastFrom) > x1 - 60 ? -4 : 4)} y=${y0 - 3} textAnchor=${sx(p.forecastFrom) > x1 - 60 ? 'end' : 'start'} style=${S.axisStrong}>${p.forecastLabel || 'Forecast'}</text>
          </g>` : null}
        ${goal ? html`<g>
            <line x1=${x0} x2=${x1} y1=${sy(goal.y)} y2=${sy(goal.y)} strokeWidth="1" strokeDasharray="6 4" style=${{ stroke: 'var(--ink-2)' }} />
            <text x=${x0 + 4} y=${sy(goal.y) - 5} style=${S.axisStrong}>${goal.label || 'Goal ' + yf(goal.y)}</text>
          </g>` : null}
        ${markers.filter(function (m) { return m.kind === 'event'; }).map(function (m) {
          if (m.x < xd0 || m.x > xd1) return null;
          var x = sx(m.x), ly = y0 + 10 + (evK++ % 2) * 12, room = Math.max(4, Math.floor((x1 - x) / 6));
          return html`<g key=${'ev-' + m.x + '-' + (m.label || '')}>
            <line x1=${x} x2=${x} y1=${y0} y2=${y1} strokeWidth="1" strokeDasharray="1 3" style=${{ stroke: 'var(--ink-3)' }} />
            <text x=${x + 3} y=${ly} style=${{ fill: 'var(--ink-3)', fontSize: 10 }}>${truncate(m.label, room)}</text>
          </g>`;
        })}
        ${series.map(function (s, si) {
          var col = tokenColor(s.color, si);
          var pts = s.points.filter(function (q) { return q && fin(q.x); }).map(function (q) { return fin(q.y) ? [sx(q.x), sy(q.y)] : null; });
          var li = -1;
          for (var k = pts.length - 1; k >= 0; k--) if (pts[k]) { li = k; break; }
          return html`<g key=${'s-' + (s.id || si)}>
            <path d=${linePath(pts)} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray=${s.dashed ? '5 4' : null} style=${{ stroke: col }} />
            ${li >= 0 && !s.dashed ? html`<circle cx=${pts[li][0]} cy=${pts[li][1]} r="4" strokeWidth="2" style=${{ fill: col, stroke: 'var(--surface)' }} />` : null}
          </g>`;
        })}
        ${markers.filter(function (m) { return m.kind === 'anomaly'; }).map(function (m) {
          if (m.x < xd0 || m.x > xd1) return null;
          var yv = fin(m.y) ? m.y : (maps[0] ? maps[0][m.x] : null);
          if (!fin(yv)) return null;
          return html`<g key=${'an-' + m.x + '-' + (m.label || '')}>
            <path d=${diamond(sx(m.x), sy(yv), 6)} strokeWidth="2" style=${{ fill: m.tone === 'warn' ? 'var(--warn)' : 'var(--crit)', stroke: 'var(--surface)' }} />
            <title>${m.label || 'Anomaly'}</title>
          </g>`;
        })}
        ${hasRail ? html`<line x1=${x0} x2=${x1} y1=${railY} y2=${railY} strokeWidth="6" strokeLinecap="round" style=${{ stroke: 'var(--agent-soft)' }} />` : null}
        ${markers.filter(function (m) { return m.kind === 'agent'; }).map(function (m, k) {
          if (m.x < xd0 || m.x > xd1) return null;
          var x = sx(m.x), act = typeof m.onClick === 'function';
          function fire(e) { if (act) m.onClick(m, e); }
          return html`<g key=${'ag-' + (m.id || m.proposalId || (m.x + '-' + k))} className="ch-agent-marker"
              role=${act ? 'button' : null} tabIndex=${act ? 0 : null} aria-label=${m.label || 'Agent action'}
              onClick=${fire} onKeyDown=${function (e) { if (act && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fire(e); } }}
              style=${{ cursor: act ? 'pointer' : 'default' }}>
            <circle cx=${x} cy=${railY} r="13" style=${{ fill: 'transparent' }} />
            <circle cx=${x} cy=${railY} r="5" strokeWidth="2" style=${{ fill: 'var(--agent)', stroke: 'var(--surface)' }} />
            <title>${m.label || 'Agent action'}</title>
          </g>`;
        })}
        ${showHover ? html`<g pointerEvents="none">
            <line x1=${hpx} x2=${hpx} y1=${y0} y2=${y1} strokeWidth="1" style=${{ stroke: 'var(--ink-3)' }} />
            ${series.map(function (s, si) {
              var v = maps[si][hx];
              return fin(v) ? html`<circle key=${'h' + si} cx=${hpx} cy=${sy(v)} r="4" strokeWidth="2" style=${{ fill: tokenColor(s.color, si), stroke: 'var(--surface)' }} />` : null;
            })}
          </g>` : null}
      </svg>`;
      var q = showHover ? bandMap[hx] : null;
      return html`<div className="ch-plot" tabIndex="0" onKeyDown=${onKey} onBlur=${function () { setHx(null); }}
          aria-label=${'Interactive chart. Use left and right arrow keys to read values.'} style=${{ position: 'relative', outlineOffset: 2 }}>
        ${svg}
        <${Tip} show=${showHover} x=${hpx} y=${y0} width=${W}>
          <div style=${{ fontWeight: 600, marginBottom: 2 }}>${showHover ? xf(hx) : ''}</div>
          ${series.map(function (s, si) {
            var v = showHover ? maps[si][hx] : null;
            return fin(v) ? html`<${TipRow} key=${'t' + si} color=${tokenColor(s.color, si)} label=${s.label || 'Series ' + (si + 1)} value=${yf(v)} />` : null;
          })}
          ${q && fin(q.lo) && fin(q.hi) ? html`<${TipRow} label=${p.bandLabel || '80% range'} value=${yf(q.lo) + DASH + yf(q.hi)} />` : null}
        <//>
      </div>`;
    }
    return html`<${ChartFrame} className="ch-line" ariaLabel=${ariaLabel} legend=${legend} table=${p.noTable ? null : table} render=${render} />`;
  }

  /* ================= ForecastChart (LineChart preset) ================= */
  function ForecastChart(p) {
    var src = p.data || {};
    var yf = resolveFmt(p.yFormat, FORMATS.num);
    var actualIn = p.actual || src.actual || [];
    var fcIn = p.forecast || p.points || src.points || [];
    var goalIn = p.goal != null ? p.goal : src.goal;
    var actual = actualIn.map(function (q) {
      return { x: fin(q.day) ? q.day : q.x, y: fin(q.value) ? q.value : q.y };
    }).filter(function (q) { return fin(q.x); });
    var fc = fcIn.map(function (q) {
      return { x: fin(q.day) ? q.day : q.x, mean: fin(q.mean) ? q.mean : q.y, lo80: q.lo80, hi80: q.hi80, lo95: q.lo95, hi95: q.hi95 };
    }).filter(function (q) { return fin(q.x); });

    if (p.cumulative) {
      var run = 0;
      actual = actual.map(function (q) { run += fin(q.y) ? q.y : 0; return { x: q.x, y: run }; });
      var base = run, v80 = 0, v95 = 0;
      fc = fc.map(function (q) {
        base += fin(q.mean) ? q.mean : 0;
        var s80 = fin(q.hi80) && fin(q.lo80) ? (q.hi80 - q.lo80) / (2 * 1.2816) : NaN;
        var s95 = fin(q.hi95) && fin(q.lo95) ? (q.hi95 - q.lo95) / (2 * 1.96) : NaN;
        if (fin(s80)) v80 += s80 * s80;
        if (fin(s95)) v95 += s95 * s95;
        return {
          x: q.x, mean: base,
          lo80: fin(s80) ? base - 1.2816 * Math.sqrt(v80) : NaN, hi80: fin(s80) ? base + 1.2816 * Math.sqrt(v80) : NaN,
          lo95: fin(s95) ? base - 1.96 * Math.sqrt(v95) : NaN, hi95: fin(s95) ? base + 1.96 * Math.sqrt(v95) : NaN
        };
      });
    }
    var last = null;
    for (var i = actual.length - 1; i >= 0; i--) if (fin(actual[i].y)) { last = actual[i]; break; }
    var fcPts = fc.map(function (q) { return { x: q.x, y: q.mean }; });
    var b80 = fc.filter(function (q) { return fin(q.lo80) && fin(q.hi80); }).map(function (q) { return { x: q.x, lo: q.lo80, hi: q.hi80 }; });
    var b95 = fc.filter(function (q) { return fin(q.lo95) && fin(q.hi95); }).map(function (q) { return { x: q.x, lo: q.lo95, hi: q.hi95 }; });
    if (last && fc.length && fc[0].x > last.x) {
      fcPts.unshift({ x: last.x, y: last.y });
      if (b80.length) b80.unshift({ x: last.x, lo: last.y, hi: last.y });
      if (b95.length) b95.unshift({ x: last.x, lo: last.y, hi: last.y });
    }
    var goal = null;
    if (fin(goalIn)) goal = { y: goalIn, label: 'Goal ' + yf(goalIn) };
    else if (goalIn && fin(goalIn.y)) goal = goalIn;
    else if (goalIn && fin(goalIn.value)) goal = { y: goalIn.value, label: goalIn.label || 'Goal ' + yf(goalIn.value) };
    var endF = fc.length ? fc[fc.length - 1] : null;
    var aria = p.ariaLabel || (endF && fin(endF.mean)
      ? (p.label || 'Forecast') + ': ' + yf(endF.mean) + ' projected by ' + shortDay(endF.x) +
        (fin(endF.lo80) ? ' (80% range ' + yf(endF.lo80) + DASH + yf(endF.hi80) + ')' : '') + (goal ? ', goal ' + yf(goal.y) : '')
      : (last ? (p.label || 'Actual') + ': ' + yf(last.y) + ' through ' + shortDay(last.x) : 'Forecast: no data yet'));
    var labels = p.labels || {};
    var series = [{ id: 'actual', label: labels.actual || 'Actual', color: p.color || 'chart-1', points: actual }];
    if (fcPts.length) series.push({ id: 'forecast', label: labels.forecast || 'Forecast', color: p.color || 'chart-1', dashed: true, points: fcPts });
    var nowX = fin(p.nowX) ? p.nowX : (last ? last.x : null);
    return html`<${LineChart} series=${series} band=${b80.length > 1 ? { points: b80 } : null}
      band95=${!p.hide95 && b95.length > 1 ? { points: b95 } : null} forecastFrom=${nowX} forecastLabel=${p.nowLabel || 'Today'}
      goal=${goal} markers=${p.markers} xFormat=${p.xFormat} yFormat=${p.yFormat} height=${p.height || 240}
      ariaLabel=${aria} emptyText=${p.emptyText || 'Forecast appears after 7 days of data.'} noTable=${p.noTable} />`;
  }

  /* ================= BarChart (h | v, optional CI whiskers) ================= */
  function BarChart(p) {
    var React = R();
    var hs = React.useState(null), hk = hs[0], setHk = hs[1];
    var data = (p.data || []).filter(function (d) { return d && d.key != null; });
    var f = resolveFmt(p.format, FORMATS.num);
    var orient = p.orientation === 'v' ? 'v' : 'h';
    var good = data.filter(function (d) { return fin(d.value); });
    var top = good.slice().sort(function (a, b) { return b.value - a.value; })[0];
    var aria = p.ariaLabel || (good.length ? (p.label || 'Bar chart') + ', ' + good.length + ' bars; highest ' + (top.label || top.key) + ' at ' + f(top.value) : (p.label || 'Bar chart') + ': no data yet');
    var table = {
      columns: [{ key: 'l', label: p.categoryLabel || 'Item', align: 'left' }, { key: 'v', label: p.valueLabel || 'Value' }]
        .concat(data.some(function (d) { return d.ci; }) ? [{ key: 'ci', label: '95% interval' }] : []),
      rows: data.map(function (d) {
        return { _key: String(d.key), l: d.label || d.key, v: f(d.value), ci: d.ci && fin(d.ci[0]) && fin(d.ci[1]) ? f(d.ci[0]) + DASH + f(d.ci[1]) : DASH };
      })
    };
    if (!good.length) {
      return html`<${ChartFrame} className="ch-bar" ariaLabel=${aria} render=${function () { return html`<${EmptyChart} height=${p.height || 120} text=${p.emptyText || 'No data in this range yet.'} />`; }} />`;
    }
    var vals = [0];
    data.forEach(function (d) {
      if (fin(d.value)) vals.push(d.value);
      if (d.ci) { if (fin(d.ci[0])) vals.push(d.ci[0]); if (fin(d.ci[1])) vals.push(d.ci[1]); }
    });
    var ex = extent(vals);
    function colorOf(d, i) { return tokenColor(d.color || p.color || 'chart-1', i); }
    function op(d) { return p.highlightKey != null && d.key !== p.highlightKey ? 0.45 : 1; }
    function click(d) { if (typeof p.onSelect === 'function') p.onSelect(d.key, d); }

    function render(W) {
      var hover = null, tipX = 0, tipY = 0;
      if (orient === 'h') {
        var labW = clamp(Math.max.apply(null, data.map(function (d) { return textW(d.label || d.key, 12); })) + 10, 48, W * 0.38);
        var valW = clamp(Math.max.apply(null, data.map(function (d) { return textW(f(d.value), 11); })) + 10, 32, W * 0.22);
        var rowH = 30, mt = 4, mb = 20, Hh = mt + data.length * rowH + mb;
        var t = niceTicks(ex[0], ex[1], Math.max(2, Math.floor((W - labW - valW) / 90)));
        var sx = linScale(t.lo, t.hi, labW, W - valW), zx = sx(0);
        var bh = Math.min(18, rowH - 10);
        var nodes = data.map(function (d, i) {
          var y = mt + i * rowH, by = y + (rowH - bh) / 2, v = fin(d.value) ? d.value : 0;
          var xe = sx(v), isH = hk === d.key;
          if (isH) { hover = d; tipX = Math.max(xe, zx); tipY = y; }
          var ci = d.ci && fin(d.ci[0]) && fin(d.ci[1]) ? [sx(d.ci[0]), sx(d.ci[1])] : null;
          var lx = v >= 0 ? Math.max(xe, ci ? ci[1] : xe) + 6 : zx + 6;
          return html`<g key=${'b-' + d.key} onPointerEnter=${function () { setHk(d.key); }} onPointerLeave=${function () { setHk(null); }}
              onClick=${function () { click(d); }} style=${{ cursor: p.onSelect ? 'pointer' : 'default' }}>
            <rect x="0" y=${y} width=${W} height=${rowH} style=${{ fill: isH ? 'var(--surface-2)' : 'transparent' }} />
            <text x=${labW - 8} y=${y + rowH / 2} textAnchor="end" dominantBaseline="central" style=${{ fill: 'var(--ink-2)', fontSize: 12, fontWeight: d.key === p.highlightKey ? 600 : 400 }}>${truncate(d.label || d.key, Math.floor((labW - 10) / 7))}</text>
            <path d=${barPathH(zx, xe, by, bh, 4)} style=${{ fill: colorOf(d, i), opacity: op(d) }} />
            ${ci ? html`<g strokeWidth="1.5" style=${{ stroke: 'var(--ink-2)' }}>
                <line x1=${ci[0]} x2=${ci[1]} y1=${by + bh / 2} y2=${by + bh / 2} />
                <line x1=${ci[0]} x2=${ci[0]} y1=${by + 3} y2=${by + bh - 3} />
                <line x1=${ci[1]} x2=${ci[1]} y1=${by + 3} y2=${by + bh - 3} />
              </g>` : null}
            <text x=${lx} y=${y + rowH / 2} dominantBaseline="central" style=${{ fill: 'var(--ink)', fontSize: 11 }}>${f(d.value)}</text>
          </g>`;
        });
        return html`<div style=${{ position: 'relative' }}>
          <svg role="img" aria-label=${aria} viewBox=${'0 0 ' + W + ' ' + Hh} width=${W} height=${Hh} style=${S.svg}>
            <title>${aria}</title>
            ${t.ticks.map(function (tk, k) {
              return html`<g key=${'t' + k}><line x1=${sx(tk)} x2=${sx(tk)} y1=${mt} y2=${Hh - mb} strokeWidth="1" style=${tk === 0 ? S.base : S.grid} />
                <text x=${sx(tk)} y=${Hh - 6} textAnchor="middle" style=${S.axis}>${f(tk)}</text></g>`;
            })}
            ${nodes}
          </svg>
          ${barTip(hover, tipX, tipY, W)}
        </div>`;
      }
      var Hv = fin(p.height) ? p.height : 200;
      var mtv = 18, mbv = 34;
      var tv = niceTicks(ex[0], ex[1], Hv < 160 ? 3 : 4);
      var yl = tv.ticks.map(f);
      var mlv = clamp(Math.max.apply(null, yl.map(function (s) { return textW(s, 11); })) + 10, 30, W * 0.25);
      var slot = (W - mlv - 6) / Math.max(1, data.length), bw = Math.min(24, slot * 0.6);
      var sy = linScale(tv.lo, tv.hi, Hv - mbv, mtv), zy = sy(0);
      var cols = data.map(function (d, i) {
        var cx = mlv + slot * i + slot / 2, v = fin(d.value) ? d.value : 0, ye = sy(v), isH = hk === d.key;
        if (isH) { hover = d; tipX = cx; tipY = Math.min(ye, zy) - 8; }
        var ci = d.ci && fin(d.ci[0]) && fin(d.ci[1]) ? [sy(d.ci[0]), sy(d.ci[1])] : null;
        return html`<g key=${'b-' + d.key} onPointerEnter=${function () { setHk(d.key); }} onPointerLeave=${function () { setHk(null); }}
            onClick=${function () { click(d); }} style=${{ cursor: p.onSelect ? 'pointer' : 'default' }}>
          <rect x=${cx - slot / 2} y=${mtv} width=${slot} height=${Hv - mtv - mbv} style=${{ fill: isH ? 'var(--surface-2)' : 'transparent' }} />
          <path d=${barPathV(zy, ye, cx - bw / 2, bw, 4)} style=${{ fill: colorOf(d, i), opacity: op(d) }} />
          ${ci ? html`<g strokeWidth="1.5" style=${{ stroke: 'var(--ink-2)' }}>
              <line x1=${cx} x2=${cx} y1=${ci[0]} y2=${ci[1]} />
              <line x1=${cx - 4} x2=${cx + 4} y1=${ci[0]} y2=${ci[0]} /><line x1=${cx - 4} x2=${cx + 4} y1=${ci[1]} y2=${ci[1]} />
            </g>` : null}
          ${slot >= 34 ? html`<text x=${cx} y=${Math.min(ye, ci ? Math.min(ci[0], ci[1]) : ye) - 5} textAnchor="middle" style=${{ fill: 'var(--ink)', fontSize: 11 }}>${f(d.value)}</text>` : null}
          <text x=${cx} y=${Hv - mbv + 16} textAnchor="middle" style=${{ fill: 'var(--ink-2)', fontSize: 11 }}>${truncate(d.label || d.key, Math.max(3, Math.floor(slot / 6.5)))}</text>
        </g>`;
      });
      return html`<div style=${{ position: 'relative' }}>
        <svg role="img" aria-label=${aria} viewBox=${'0 0 ' + W + ' ' + Hv} width=${W} height=${Hv} style=${S.svg}>
          <title>${aria}</title>
          ${tv.ticks.map(function (tk, k) {
            return html`<g key=${'t' + k}><line x1=${mlv} x2=${W} y1=${sy(tk)} y2=${sy(tk)} strokeWidth="1" style=${tk === 0 ? S.base : S.grid} />
              <text x=${mlv - 6} y=${sy(tk)} textAnchor="end" dominantBaseline="central" style=${S.axis}>${yl[k]}</text></g>`;
          })}
          ${cols}
        </svg>
        ${barTip(hover, tipX, tipY, W)}
      </div>`;
    }
    function barTip(d, x, y, W) {
      if (!d) return null;
      return html`<${Tip} show=${true} x=${x} y=${y} width=${W}>
        <div style=${{ fontWeight: 600 }}>${d.label || d.key}</div>
        <${TipRow} label=${p.valueLabel || 'Value'} value=${f(d.value)} />
        ${d.ci && fin(d.ci[0]) ? html`<${TipRow} label="95% interval" value=${f(d.ci[0]) + DASH + f(d.ci[1])} />` : null}
      <//>`;
    }
    return html`<${ChartFrame} className=${'ch-bar ch-bar-' + orient} ariaLabel=${aria} table=${p.noTable ? null : table} render=${render} />`;
  }

  /* ================= StackedBar (horizontal, 2px surface gaps) ================= */
  function StackedBar(p) {
    var React = R();
    var hs = React.useState(null), hv = hs[0], setHv = hs[1];
    var rows = (p.rows || []).filter(function (r) { return r && r.key != null; });
    var keys = (p.keys || []).filter(function (k) { return k && k.key != null; });
    var f = resolveFmt(p.format, FORMATS.num);
    function partVal(r, k) {
      var pts = r.parts || [];
      for (var i = 0; i < pts.length; i++) if (pts[i] && pts[i].key === k) return fin(pts[i].value) && pts[i].value > 0 ? pts[i].value : 0;
      return 0;
    }
    var totals = rows.map(function (r) { return keys.reduce(function (s, k) { return s + partVal(r, k.key); }, 0); });
    var maxT = Math.max.apply(null, [0].concat(totals));
    var aria = p.ariaLabel || ((p.label || 'Stacked bars') + ': ' + rows.length + ' rows by ' + keys.map(function (k) { return k.label; }).join(', '));
    var legend = keys.map(function (k, i) { return { key: k.key, label: k.label || k.key, color: tokenColor(k.color, i) }; });
    var table = {
      columns: [{ key: 'l', label: p.rowLabel || 'Row', align: 'left' }].concat(keys.map(function (k) { return { key: 'k-' + k.key, label: k.label || k.key }; })).concat([{ key: 'tot', label: 'Total' }]),
      rows: rows.map(function (r, ri) {
        var o = { _key: String(r.key), l: r.label || r.key, tot: f(totals[ri]) };
        keys.forEach(function (k) { o['k-' + k.key] = f(partVal(r, k.key)); });
        return o;
      })
    };
    if (!rows.length || !(maxT > 0)) {
      return html`<${ChartFrame} className="ch-stack" ariaLabel=${aria} legend=${legend} render=${function () { return html`<${EmptyChart} height=${p.height || 120} text=${p.emptyText || 'No data in this range yet.'} />`; }} />`;
    }
    function render(W) {
      var labW = clamp(Math.max.apply(null, rows.map(function (r) { return textW(r.label || r.key, 12); })) + 10, 48, W * 0.36);
      var totW = clamp(Math.max.apply(null, totals.map(function (t) { return textW(f(t), 11); })) + 10, 36, W * 0.22);
      var rowH = 32, bh = 18, Hh = rows.length * rowH + 4;
      var sx = linScale(0, maxT, labW, W - totW);
      var hover = null, tipX = 0, tipY = 0;
      var nodes = rows.map(function (r, ri) {
        var y = ri * rowH + 2, by = y + (rowH - bh) / 2, acc = 0;
        var segs = [];
        var present = keys.filter(function (k) { return partVal(r, k.key) > 0; });
        present.forEach(function (k, j) {
          var v = partVal(r, k.key), xa = sx(acc), xb = sx(acc + v), last = j === present.length - 1;
          acc += v;
          var x1 = last ? xb : Math.max(xa + 0.5, xb - 2);
          var id = r.key + '|' + k.key, ki = keys.indexOf(k);
          if (hv === id) { hover = { r: r, k: k, v: v, t: totals[ri] }; tipX = (xa + xb) / 2; tipY = y; }
          segs.push(html`<path key=${'s-' + k.key} d=${last ? barPathH(xa, x1, by, bh, 4) : 'M' + r2(xa) + ' ' + r2(by) + 'H' + r2(x1) + 'V' + r2(by + bh) + 'H' + r2(xa) + 'Z'}
            onPointerEnter=${function () { setHv(id); }} onPointerLeave=${function () { setHv(null); }}
            style=${{ fill: tokenColor(k.color, ki), opacity: hv && hv !== id && hv.indexOf(r.key + '|') === 0 ? 0.6 : 1 }} />`);
        });
        return html`<g key=${'r-' + r.key}>
          <text x=${labW - 8} y=${y + rowH / 2} textAnchor="end" dominantBaseline="central" style=${{ fill: 'var(--ink-2)', fontSize: 12 }}>${truncate(r.label || r.key, Math.floor((labW - 10) / 7))}</text>
          ${segs}
          <text x=${sx(totals[ri]) + 6} y=${y + rowH / 2} dominantBaseline="central" style=${{ fill: 'var(--ink)', fontSize: 11 }}>${f(totals[ri])}</text>
        </g>`;
      });
      return html`<div style=${{ position: 'relative' }}>
        <svg role="img" aria-label=${aria} viewBox=${'0 0 ' + W + ' ' + Hh} width=${W} height=${Hh} style=${S.svg}>
          <title>${aria}</title>
          <line x1=${labW} x2=${labW} y1="0" y2=${Hh} strokeWidth="1" style=${S.base} />
          ${nodes}
        </svg>
        ${hover ? html`<${Tip} show=${true} x=${tipX} y=${tipY} width=${W}>
          <div style=${{ fontWeight: 600 }}>${hover.r.label || hover.r.key}</div>
          <${TipRow} color=${tokenColor(hover.k.color, keys.indexOf(hover.k))} label=${hover.k.label || hover.k.key} value=${f(hover.v)} />
          <${TipRow} label="Share of row" value=${FORMATS.pct(hover.t > 0 ? hover.v / hover.t : 0)} />
        <//>` : null}
      </div>`;
    }
    return html`<${ChartFrame} className="ch-stack" ariaLabel=${aria} legend=${legend} table=${p.noTable ? null : table} render=${render} />`;
  }

  /* ================= Funnel ================= */
  function Funnel(p) {
    var stages = (p.stages || []).filter(function (s) { return s && s.key != null; });
    var f = resolveFmt(p.format, FORMATS.num);
    var first = stages.length && fin(stages[0].value) ? stages[0].value : 0;
    var lastS = stages[stages.length - 1];
    var aria = p.ariaLabel || (stages.length ? 'Funnel: ' + stages.map(function (s) { return s.label + ' ' + f(s.value); }).join(', ') : 'Funnel: no data yet');
    function stepPct(i) {
      if (i === 0) return null;
      var a = stages[i - 1].value, b = stages[i].value;
      return fin(a) && fin(b) && a > 0 ? b / a : null;
    }
    var table = {
      columns: [{ key: 'l', label: 'Stage', align: 'left' }, { key: 'v', label: 'Count' }, { key: 'p', label: 'From previous' }, { key: 'o', label: 'From first' }],
      rows: stages.map(function (s, i) {
        var sp = stepPct(i);
        return { _key: String(s.key), l: s.label, v: f(s.value), p: sp == null ? DASH : FORMATS.pct(sp), o: first > 0 && fin(s.value) ? FORMATS.pct(s.value / first) : DASH };
      })
    };
    if (!(first > 0)) {
      return html`<${ChartFrame} className="ch-funnel" ariaLabel=${aria} render=${function () { return html`<${EmptyChart} height=${120} text=${p.emptyText || 'No sends in this range yet.'} />`; }} />`;
    }
    function render(W) {
      var rowH = 44, bh = 14, Hh = stages.length * rowH;
      return html`<svg role="img" aria-label=${aria} viewBox=${'0 0 ' + W + ' ' + Hh} width=${W} height=${Hh} style=${S.svg}>
        <title>${aria}</title>
        ${stages.map(function (s, i) {
          var y = i * rowH, v = fin(s.value) ? Math.max(0, s.value) : 0, bw = Math.max(v > 0 ? 2 : 0, (W - 2) * Math.min(1, v / first));
          var sp = stepPct(i);
          return html`<g key=${'f-' + s.key}>
            <text x="0" y=${y + 14} style=${{ fill: 'var(--ink)', fontSize: 12, fontWeight: 500 }}>${s.label}
              <tspan dx="8" style=${{ fill: 'var(--ink)', fontWeight: 600 }}>${f(s.value)}</tspan>
            </text>
            ${sp != null ? html`<text x=${W} y=${y + 14} textAnchor="end" style=${{ fill: 'var(--ink-3)', fontSize: 11 }}>${FORMATS.pct(sp) + ' of ' + String(stages[i - 1].label).toLowerCase()}</text>` : null}
            <rect x="0" y=${y + 22} width=${W} height=${bh} rx="3" style=${{ fill: 'var(--surface-2)' }} />
            ${bw > 0 ? html`<path d=${barPathH(0, bw, y + 22, bh, 4)} style=${{ fill: tokenColor(p.color || 'chart-1', 0) }} />` : null}
          </g>`;
        })}
      </svg>`;
    }
    return html`<${ChartFrame} className="ch-funnel" ariaLabel=${aria + (lastS && first > 0 && fin(lastS.value) ? '. Overall ' + FORMATS.pct(lastS.value / first) : '')} table=${p.noTable ? null : table} render=${render} />`;
  }

  /* ================= Histogram ================= */
  function Histogram(p) {
    var React = R();
    var hs = React.useState(null), hi = hs[0], setHi = hs[1];
    var bins = (p.bins || []).filter(function (b) { return b && fin(b.x0) && fin(b.x1); });
    var f = resolveFmt(p.format, FORMATS.num);
    var H = fin(p.height) ? p.height : 56;
    var maxC = Math.max.apply(null, [0].concat(bins.map(function (b) { return fin(b.count) ? b.count : 0; })));
    var total = bins.reduce(function (s, b) { return s + (fin(b.count) ? b.count : 0); }, 0);
    var aria = p.ariaLabel || (total > 0 ? (p.label || 'Distribution') + ': ' + FORMATS.int(total) + ' profiles from ' + f(bins[0].x0) + ' to ' + f(bins[bins.length - 1].x1) : (p.label || 'Distribution') + ': no data yet');
    var table = {
      columns: [{ key: 'r', label: 'Range', align: 'left' }, { key: 'c', label: 'Count' }],
      rows: bins.map(function (b, i) { return { _key: String(i), r: f(b.x0) + DASH + f(b.x1), c: FORMATS.int(fin(b.count) ? b.count : 0) }; })
    };
    if (!(maxC > 0)) {
      return html`<${ChartFrame} className="ch-hist" ariaLabel=${aria} render=${function () { return html`<${EmptyChart} height=${H} text=${p.emptyText || 'No profiles to chart.'} />`; }} />`;
    }
    function render(W) {
      var mb = 14, ph = H - mb, n = bins.length, slot = W / n, gap = Math.min(2, slot * 0.2), bw = Math.max(0.5, slot - gap);
      var col = tokenColor(p.color || 'chart-1', 0);
      var markX = fin(p.marker) ? linScale(bins[0].x0, bins[n - 1].x1, 0, W)(p.marker) : null;
      var hb = hi != null ? bins[hi] : null;
      return html`<div style=${{ position: 'relative' }}>
        <svg role="img" aria-label=${aria} viewBox=${'0 0 ' + W + ' ' + H} width=${W} height=${H} style=${S.svg} onPointerLeave=${function () { setHi(null); }}>
          <title>${aria}</title>
          ${bins.map(function (b, i) {
            var c = fin(b.count) ? b.count : 0, h = ph * c / maxC, x = i * slot;
            return html`<g key=${'h' + i} onPointerEnter=${function () { setHi(i); }}>
              <rect x=${x} y="0" width=${slot} height=${ph} style=${{ fill: 'transparent' }} />
              ${h > 0 ? html`<path d=${barPathV(ph, ph - Math.max(1, h), x + gap / 2, bw, Math.min(3, bw / 2))} style=${{ fill: col, opacity: hi == null || hi === i ? 1 : 0.55 }} />` : null}
            </g>`;
          })}
          <line x1="0" x2=${W} y1=${ph} y2=${ph} strokeWidth="1" style=${S.base} />
          ${markX != null ? html`<line x1=${markX} x2=${markX} y1="0" y2=${ph} strokeWidth="2" style=${{ stroke: 'var(--ink)' }} />` : null}
          <text x="0" y=${H - 2} style=${S.axis}>${f(bins[0].x0)}</text>
          <text x=${W} y=${H - 2} textAnchor="end" style=${S.axis}>${f(bins[n - 1].x1)}</text>
        </svg>
        <${Tip} show=${!!hb} x=${hb ? hi * slot + slot / 2 : 0} y=${0} width=${W}>
          ${hb ? html`<${TipRow} label=${f(hb.x0) + DASH + f(hb.x1)} value=${FORMATS.int(hb.count || 0)} />` : null}
        <//>
      </div>`;
    }
    return html`<${ChartFrame} className="ch-hist" ariaLabel=${aria} table=${p.noTable ? null : table} render=${render} />`;
  }

  /* ================= HourStrip (24 columns, quiet hours shaded) ================= */
  function inQuiet(h, q) {
    if (!q || !fin(q[0]) || !fin(q[1])) return false;
    return q[0] > q[1] ? (h >= q[0] || h < q[1]) : (h >= q[0] && h < q[1]);
  }
  function HourStrip(p) {
    var React = R();
    var hs = React.useState(null), hh = hs[0], setHh = hs[1];
    var vals = [];
    for (var i = 0; i < 24; i++) { var v = p.values ? p.values[i] : null; vals.push(fin(v) && v > 0 ? v : 0); }
    var maxV = Math.max.apply(null, vals);
    var hl = Array.isArray(p.highlight) ? p.highlight : (fin(p.highlight) ? [p.highlight] : []);
    var vf = resolveFmt(p.format, FORMATS.num);
    var peak = maxV > 0 ? vals.indexOf(maxV) : -1;
    var aria = p.ariaLabel || (maxV > 0 ? (p.label || 'Opens by hour') + ': peak at ' + hourLabel(peak) + (hl.length ? ', selected ' + hl.map(hourLabel).join(', ') : '') : (p.label || 'Opens by hour') + ': no data yet');
    var table = {
      columns: [{ key: 'h', label: 'Hour', align: 'left' }, { key: 'v', label: p.valueLabel || 'Value' }, { key: 'q', label: 'Quiet hours' }],
      rows: vals.map(function (v, h) { return { _key: String(h), h: hourLabel(h), v: vf(v), q: inQuiet(h, p.quiet) ? 'Yes' : '' }; })
    };
    function render(W) {
      var H = fin(p.height) ? p.height : 56, mb = 14, ph = H - mb, slot = W / 24, bw = Math.max(1, slot - 2);
      return html`<div style=${{ position: 'relative' }}>
        <svg role="img" aria-label=${aria} viewBox=${'0 0 ' + W + ' ' + H} width=${W} height=${H} style=${S.svg} onPointerLeave=${function () { setHh(null); }}>
          <title>${aria}</title>
          ${vals.map(function (v, h) {
            var x = h * slot, q = inQuiet(h, p.quiet), isHl = hl.indexOf(h) >= 0;
            var bh = maxV > 0 ? Math.max(v > 0 ? 2 : 0, ph * v / maxV) : 0;
            return html`<g key=${'hr' + h} onPointerEnter=${function () { setHh(h); }}>
              <rect x=${x} y="0" width=${slot} height=${ph} style=${{ fill: q ? 'var(--surface-2)' : 'transparent' }} />
              ${bh > 0 ? html`<path d=${barPathV(ph, ph - bh, x + 1, bw, Math.min(3, bw / 2))}
                  style=${{ fill: isHl ? 'var(--accent)' : 'var(--chart-1)', opacity: isHl || !hl.length ? (q ? 0.5 : 1) : (q ? 0.3 : 0.55) }} />` : null}
              ${isHl ? html`<rect x=${x + 0.5} y="0.5" width=${slot - 1} height=${ph - 1} rx="2" fill="none" strokeWidth="1" style=${{ stroke: 'var(--accent)' }} />` : null}
            </g>`;
          })}
          <line x1="0" x2=${W} y1=${ph} y2=${ph} strokeWidth="1" style=${S.base} />
          ${[0, 6, 12, 18].map(function (h) {
            return html`<text key=${'l' + h} x=${h * slot + (h === 0 ? 0 : slot / 2)} y=${H - 2} textAnchor=${h === 0 ? 'start' : 'middle'} style=${S.axis}>${hourLabel(h)}</text>`;
          })}
        </svg>
        <${Tip} show=${hh != null} x=${hh != null ? hh * slot + slot / 2 : 0} y=${0} width=${W}>
          ${hh != null ? html`<${TipRow} label=${hourLabel(hh) + (inQuiet(hh, p.quiet) ? ' (quiet hours)' : '')} value=${vf(vals[hh])} />` : null}
        <//>
      </div>`;
    }
    var legend = p.quiet ? [{ key: 'q', label: 'Quiet hours (no SMS or push)', color: 'surface-2' }] : null;
    return html`<${ChartFrame} className="ch-hours" ariaLabel=${aria} legend=${p.noLegend ? null : legend} table=${p.noTable ? null : table} render=${render} />`;
  }

  /* ================= Heatmap (sequential single hue) ================= */
  function lab(x) { return x && typeof x === 'object' ? (x.label != null ? x.label : x.key) : String(x); }
  function keyOf(x, i) { return x && typeof x === 'object' ? (x.key != null ? x.key : i) : (x != null ? x : i); }
  function Heatmap(p) {
    var rows = p.rows || [], cols = p.cols || [], values = p.values || [];
    var f = resolveFmt(p.format, FORMATS.num);
    function val(r, c) { var row = values[r]; var v = row ? row[c] : null; return fin(v) ? v : null; }
    var all = [];
    rows.forEach(function (_, r) { cols.forEach(function (_c, c) { var v = val(r, c); if (v != null) all.push(v); }); });
    var ex = extent(all);
    var lo = fin(p.min) ? p.min : (ex ? Math.min(0, ex[0]) : 0), hiV = fin(p.max) ? p.max : (ex ? ex[1] : 1);
    var aria = p.ariaLabel || ((p.label || 'Heatmap') + ': ' + rows.length + ' rows by ' + cols.length + ' columns' + (ex ? ', values ' + f(ex[0]) + ' to ' + f(ex[1]) : ''));
    var table = {
      columns: [{ key: 'r', label: p.rowLabel || '', align: 'left' }].concat(cols.map(function (c, ci) { return { key: 'c' + ci, label: lab(c) }; })),
      rows: rows.map(function (r, ri) {
        var o = { _key: String(keyOf(r, ri)), r: lab(r) };
        cols.forEach(function (_c, ci) { o['c' + ci] = f(val(ri, ci)); });
        return o;
      })
    };
    if (!rows.length || !cols.length || !ex) {
      return html`<${ChartFrame} className="ch-heat" ariaLabel=${aria} render=${function () { return html`<${EmptyChart} height=${120} text=${p.emptyText || 'Pick at least two items to compare.'} />`; }} />`;
    }
    var act = typeof p.onCell === 'function';
    function render(W) {
      var labW = clamp(Math.max.apply(null, rows.map(function (r) { return textW(lab(r), 12); })) + 12, 60, 170);
      var cell = Math.max(40, Math.min(72, (W - labW) / cols.length));
      var colLabH = Math.min(110, Math.max.apply(null, cols.map(function (c) { return textW(truncate(lab(c), 18), 11); })) * 0.72 + 14);
      var Wt = labW + cell * cols.length + Math.max(4, Math.round(colLabH * 0.95) - cell / 2), Ht = colLabH + cell * rows.length;
      return html`<div className="k-scroll-x" style=${{ overflowX: 'auto', maxWidth: '100%' }}>
        <svg role=${typeof p.onCell === 'function' ? 'group' : 'img'} aria-label=${aria} viewBox=${'0 0 ' + Wt + ' ' + Ht} width=${Wt} height=${Ht} style=${{ display: 'block', minWidth: Wt }}>
          <title>${aria}</title>
          ${cols.map(function (c, ci) {
            var x = labW + ci * cell + cell / 2;
            return html`<text key=${'cl' + ci} x=${x} y=${colLabH - 6} transform=${'rotate(-40 ' + x + ' ' + (colLabH - 6) + ')'} style=${{ fill: 'var(--ink-2)', fontSize: 11 }}>${truncate(lab(c), 18)}</text>`;
          })}
          ${rows.map(function (r, ri) {
            var y = colLabH + ri * cell;
            return html`<g key=${'r' + keyOf(r, ri)}>
              <text x=${labW - 8} y=${y + cell / 2} textAnchor="end" dominantBaseline="central" style=${{ fill: 'var(--ink-2)', fontSize: 12 }}>${truncate(lab(r), Math.floor((labW - 10) / 7))}</text>
              ${cols.map(function (c, ci) {
                var v = val(ri, ci), t = v == null ? 0 : clamp((v - lo) / ((hiV - lo) || 1), 0, 1);
                var x = labW + ci * cell, label = lab(r) + ' and ' + lab(c) + ': ' + f(v);
                function fire() { if (act) p.onCell(ri, ci, { row: r, col: c, value: v }); }
                return html`<g key=${'c' + ci} role=${act ? 'button' : null} tabIndex=${act ? 0 : null} aria-label=${label}
                    onClick=${fire} onKeyDown=${function (e) { if (act && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fire(); } }}
                    style=${{ cursor: act ? 'pointer' : 'default' }}>
                  <rect x=${x + 1} y=${y + 1} width=${cell - 2} height=${cell - 2} rx="3"
                    style=${v == null ? { fill: 'var(--surface-2)' } : { fill: 'var(--chart-1)', fillOpacity: 0.08 + 0.92 * t }} />
                  <text x=${x + cell / 2} y=${y + cell / 2} textAnchor="middle" dominantBaseline="central"
                    style=${{ fill: t > 0.55 ? 'var(--on-accent)' : 'var(--ink)', fontSize: 11 }}>${v == null ? DASH : f(v)}</text>
                  <title>${label}</title>
                </g>`;
              })}
            </g>`;
          })}
        </svg>
      </div>`;
    }
    return html`<${ChartFrame} className="ch-heat" ariaLabel=${aria} table=${p.noTable ? null : table} render=${render} />`;
  }

  /* ================= ResponseCurve (saturating spend -> revenue) ================= */
  function respAt(c, s) {
    try { if (MC.models && typeof MC.models.response === 'function') { var r = MC.models.response(c, s); if (fin(r)) return r; } } catch (e) { /* local */ }
    return c.A * (1 - Math.exp(-s / c.B));
  }
  function margAt(c, s) {
    try { if (MC.models && typeof MC.models.marginal === 'function') { var r = MC.models.marginal(c, s); if (fin(r)) return r; } } catch (e) { /* local */ }
    return (c.A / c.B) * Math.exp(-s / c.B);
  }
  function ResponseCurve(p) {
    var React = R();
    var hs = React.useState(null), hsx = hs[0], setHsx = hs[1];
    var svgRef = React.useRef(null);
    var c = p.curve || {};
    var ok = fin(c.A) && fin(c.B) && c.A > 0 && c.B > 0;
    var f = resolveFmt(p.format, FORMATS.moneyCompact);
    var cur = fin(p.current) ? Math.max(0, p.current) : null, prop = fin(p.proposed) ? Math.max(0, p.proposed) : null;
    var maxS = fin(p.maxSpend) && p.maxSpend > 0 ? p.maxSpend : (ok ? Math.max(3 * c.B, (cur || 0) * 1.6, (prop || 0) * 1.6) : 1);
    var mCur = ok && cur != null ? margAt(c, cur) : null;
    var name = p.label || 'Response curve';
    var aria = p.ariaLabel || (ok ? name + ': at ' + f(cur) + ' spend, revenue ' + f(cur != null ? respAt(c, cur) : NaN) + (mCur != null ? ', each extra $1 returns $' + mCur.toFixed(2) : '') : name + ': not enough history to fit');
    var H = fin(p.height) ? p.height : 160;
    var N = 40, samples = [];
    if (ok) for (var i = 0; i <= N; i++) { var s = maxS * i / N; samples.push({ s: s, r: respAt(c, s) }); }
    var table = {
      columns: [{ key: 's', label: 'Spend', align: 'left' }, { key: 'r', label: 'Predicted revenue' }, { key: 'm', label: 'Return on next $1' }],
      rows: samples.filter(function (_, k) { return k % 4 === 0; }).map(function (q) { return { _key: String(q.s), s: f(q.s), r: f(q.r), m: '$' + margAt(c, q.s).toFixed(2) }; })
    };
    if (!ok) {
      return html`<${ChartFrame} className="ch-resp" ariaLabel=${aria} render=${function () { return html`<${EmptyChart} height=${H} text=${p.emptyText || 'Not enough spend history to fit a curve yet.'} />`; }} />`;
    }
    function render(W) {
      var maxR = respAt(c, maxS);
      var yt = niceTicks(0, maxR, 3), yl = yt.ticks.map(f);
      var ml = clamp(Math.max.apply(null, yl.map(function (q) { return textW(q, 11); })) + 8, 30, W * 0.3);
      var mt = 22, mb = 20, x0 = ml, x1 = W - 10, y0 = mt, y1 = H - mb;
      var sx = linScale(0, maxS, x0, x1), sy = linScale(yt.lo, yt.hi, y1, y0);
      var d = linePath(samples.map(function (q) { return [sx(q.s), sy(q.r)]; }));
      function onMove(e) {
        var pt = svgPoint(e, svgRef.current, W);
        if (!pt) return;
        setHsx(clamp((pt.x - x0) / (x1 - x0), 0, 1) * maxS);
      }
      var hx = hsx != null ? sx(hsx) : 0;
      return html`<div style=${{ position: 'relative' }}>
        <svg ref=${svgRef} role="img" aria-label=${aria} viewBox=${'0 0 ' + W + ' ' + H} width=${W} height=${H} style=${S.svg}
            onPointerMove=${onMove} onPointerLeave=${function () { setHsx(null); }}>
          <title>${aria}</title>
          ${yt.ticks.map(function (t, k) {
            return html`<g key=${'y' + k}><line x1=${x0} x2=${x1} y1=${sy(t)} y2=${sy(t)} strokeWidth="1" style=${k === 0 ? S.base : S.grid} />
              <text x=${x0 - 6} y=${sy(t)} textAnchor="end" dominantBaseline="central" style=${S.axis}>${yl[k]}</text></g>`;
          })}
          <text x=${x0} y=${H - 4} style=${S.axis}>${f(0)}</text>
          <text x=${x1} y=${H - 4} textAnchor="end" style=${S.axis}>${f(maxS) + ' spend'}</text>
          ${mCur != null ? html`<text x=${x0} y="12" style=${{ fill: 'var(--ink-2)', fontSize: 11 }}>${'Next $1 returns $' + mCur.toFixed(2)}</text>` : null}
          <path d=${d} fill="none" strokeWidth="2" strokeLinecap="round" style=${{ stroke: tokenColor(p.color || 'chart-1', 0) }} />
          ${prop != null && cur != null && Math.abs(prop - cur) > maxS * 0.005 ? html`<line x1=${sx(cur)} x2=${sx(prop)} y1=${sy(respAt(c, cur))} y2=${sy(respAt(c, prop))} strokeWidth="1" strokeDasharray="3 3" style=${{ stroke: 'var(--ink-3)' }} />` : null}
          ${cur != null ? html`<circle cx=${sx(cur)} cy=${sy(respAt(c, cur))} r="5" strokeWidth="2" style=${{ fill: tokenColor(p.color || 'chart-1', 0), stroke: 'var(--surface)' }}><title>${'Current ' + f(cur)}</title></circle>` : null}
          ${prop != null ? html`<circle cx=${sx(prop)} cy=${sy(respAt(c, prop))} r="5" strokeWidth="2" style=${{ fill: 'var(--surface)', stroke: 'var(--ink)' }}><title>${'Proposed ' + f(prop)}</title></circle>` : null}
          ${hsx != null ? html`<line x1=${hx} x2=${hx} y1=${y0} y2=${y1} strokeWidth="1" pointerEvents="none" style=${{ stroke: 'var(--ink-3)' }} />` : null}
        </svg>
        <${Tip} show=${hsx != null} x=${hx} y=${y0} width=${W}>
          ${hsx != null ? html`<div>
            <${TipRow} label="Spend" value=${f(hsx)} />
            <${TipRow} label="Revenue" value=${f(respAt(c, hsx))} />
            <${TipRow} label="Next $1 returns" value=${'$' + margAt(c, hsx).toFixed(2)} />
          </div>` : null}
        <//>
      </div>`;
    }
    var legend = prop != null ? [{ key: 'cur', label: 'Current', color: p.color || 'chart-1' }, { key: 'prop', label: 'Proposed', color: 'ink' }] : null;
    return html`<${ChartFrame} className="ch-resp" ariaLabel=${aria} legend=${legend} table=${p.noTable ? null : table} render=${render} />`;
  }

  /* ---------- exports ---------- */
  MC.charts.Sparkline = Sparkline;
  MC.charts.LineChart = LineChart;
  MC.charts.ForecastChart = ForecastChart;
  MC.charts.BarChart = BarChart;
  MC.charts.StackedBar = StackedBar;
  MC.charts.Funnel = Funnel;
  MC.charts.Histogram = Histogram;
  MC.charts.HourStrip = HourStrip;
  MC.charts.Heatmap = Heatmap;
  MC.charts.ResponseCurve = ResponseCurve;
  MC.charts.ScoreRing = ScoreRing;
  MC.charts.Legend = Legend;
  MC.charts.ChartFrame = ChartFrame;
  MC.charts.util = {
    fin: fin, clamp: clamp, niceTicks: niceTicks, linScale: linScale, extent: extent, tokenColor: tokenColor,
    resolveFmt: resolveFmt, FORMATS: FORMATS, shortDay: shortDay, hourLabel: hourLabel, truncate: truncate,
    textW: textW, useChartWidth: useChartWidth, Tip: Tip, TipRow: TipRow, TableView: TableView, EmptyChart: EmptyChart,
    barPathH: barPathH, barPathV: barPathV, diamond: diamond, S: S
  };
})();
