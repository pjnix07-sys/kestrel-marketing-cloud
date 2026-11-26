/* Marketing Cloud - journey FlowDiagram and campaign Gantt (MC.charts.*).
   Hand-written SVG, token colors only, keyboard-selectable nodes and rows. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.charts = MC.charts || {};

  var DASH = '–';
  function html() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function U() { return MC.charts.util; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function trunc(s, n) { s = s == null ? '' : String(s); return n < 2 ? '' : (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s); }
  function tw(s, px) { return String(s == null ? '' : s).length * (px || 11) * 0.58; }
  function commas(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function num(n) {
    if (!fin(n)) return DASH;
    try { if (MC.fmt && MC.fmt.num) return MC.fmt.num(n); } catch (e) { /* local */ }
    return (n < 0 ? '-' : '') + commas(n);
  }
  function chLabel(ch) {
    var L = (MC.CH && MC.CH.LABEL) || { email: 'Email', sms: 'SMS', push: 'Push', social: 'Social ads', web: 'Web ads' };
    return L[ch] || (ch ? String(ch) : '');
  }
  function pctText(v) {
    if (!fin(v)) return null;
    var p = v <= 1 ? v * 100 : v;
    return (Math.round(p * 10) / 10).toFixed(p >= 10 ? 0 : 1) + '%';
  }

  /* ---------- journey graph helpers ---------- */
  var RULE_LABEL = {
    opened: 'Opened?', clicked: 'Clicked?', purchased: 'Purchased?', consent: 'Has consent?',
    propensityAbove: 'Likely to buy?', bestChannel: 'Best channel'
  };
  function stepKicker(s) {
    if (s.type === 'send') return 'Send · ' + chLabel(s.channel);
    if (s.type === 'wait') {
      var h = fin(s.waitH) ? s.waitH : 0;
      return 'Wait · ' + (h && h % 24 === 0 ? (h / 24) + (h === 24 ? ' day' : ' days') : h + 'h');
    }
    if (s.type === 'decide') {
      var r = s.rule || {};
      if (r.kind === 'propensityAbove' && fin(r.value)) return 'Decide · propensity ≥ ' + Math.round((r.value <= 1 ? r.value * 100 : r.value)) + '%';
      return 'Decide';
    }
    if (s.type === 'entry') return 'Entry';
    if (s.type === 'exit') return 'Exit';
    return s.type ? String(s.type) : 'Step';
  }
  function stepTitle(s) {
    if (s.label) return s.label;
    if (s.type === 'decide') return RULE_LABEL[(s.rule || {}).kind] || 'Decision';
    if (s.type === 'send') return chLabel(s.channel) + ' message';
    if (s.type === 'entry') return 'Audience enters';
    if (s.type === 'exit') return 'Leaves journey';
    if (s.type === 'wait') return 'Pause before next step';
    return stepKicker(s);
  }
  function edgesOf(s) {
    var out = [];
    if (!s) return out;
    if (s.next) out.push({ to: s.next, kind: 'next', label: null });
    if (s.yes) out.push({ to: s.yes, kind: 'yes', label: 'Yes' });
    if (s.no) out.push({ to: s.no, kind: 'no', label: 'No' });
    if (s.branches) ['email', 'sms', 'push'].forEach(function (ch) { if (s.branches[ch]) out.push({ to: s.branches[ch], kind: ch, label: chLabel(ch) }); });
    return out;
  }
  function edgePct(st, kind) {
    if (!st) return null;
    if (kind === 'yes' && fin(st.yesPct)) return st.yesPct;
    if (kind === 'no' && fin(st.noPct)) return st.noPct;
    var b = st.branchPct;
    if (b && typeof b === 'object' && fin(b[kind])) return b[kind];
    if (kind === 'yes' && fin(b)) return b;
    if (kind === 'no' && fin(b)) return (b <= 1 ? 1 - b : 100 - b);
    return null;
  }
  /* BFS layering from the entry step; unreachable steps go into a final layer. */
  function layout(steps) {
    var byId = {}, order = [];
    steps.forEach(function (s) { if (s && s.id != null && !byId[s.id]) { byId[s.id] = s; order.push(s.id); } });
    if (!order.length) return { layers: [], pos: {}, byId: byId };
    var entry = null;
    for (var i = 0; i < order.length; i++) if (byId[order[i]].type === 'entry') { entry = order[i]; break; }
    if (entry == null) entry = order[0];
    var layerOf = {}, layers = [], q = [entry];
    layerOf[entry] = 0;
    while (q.length) {
      var id = q.shift(), L = layerOf[id];
      (layers[L] = layers[L] || []).push(id);
      edgesOf(byId[id]).forEach(function (e) {
        if (byId[e.to] && layerOf[e.to] == null) { layerOf[e.to] = L + 1; q.push(e.to); }
      });
    }
    var orphans = order.filter(function (oid) { return layerOf[oid] == null; });
    if (orphans.length) {
      var Lx = layers.length;
      layers[Lx] = orphans;
      orphans.forEach(function (oid) { layerOf[oid] = Lx; });
    }
    var pos = {};
    layers.forEach(function (ids, li) { ids.forEach(function (sid, ri) { pos[sid] = { layer: li, row: ri }; }); });
    return { layers: layers, pos: pos, byId: byId };
  }

  /* ================= FlowDiagram ================= */
  function FlowDiagram(p) {
    var React = R();
    var ref = React.useRef(null);
    var u = U();
    var wRaw = u ? u.useChartWidth(ref) : 0;
    var W = wRaw > 0 ? wRaw : 640;
    var steps = Array.isArray(p.steps) ? p.steps : [];
    var stats = p.stats || {}, tags = p.tags || {};
    var g = React.useMemo(function () { return layout(steps); }, [steps]);
    var vertical = p.orientation === 'v' || p.orientation === 'vertical' || ((!p.orientation || p.orientation === 'auto') && W < 640);
    var compact = !!p.compact;
    var aria = p.ariaLabel || ('Journey with ' + steps.length + ' steps: ' + steps.map(function (s) { return stepTitle(s); }).join(', then '));

    if (!g.layers.length) {
      return html`<div ref=${ref} className="ch-flow ch-empty" role="img" aria-label="Journey has no steps yet"
        style=${{ minHeight: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 13, border: '1px dashed var(--line)', borderRadius: 6, background: 'var(--surface-2)' }}>
        This journey has no steps yet.</div>`;
    }

    var maxPer = Math.max.apply(null, g.layers.map(function (l) { return l.length; }));
    var nodeH = compact ? 52 : 64, tagH = 18, pad = 8;
    var nodeW, gapMain, gapCross, Wt, Ht;
    if (vertical) {
      gapCross = 12; gapMain = 40;
      nodeW = clamp(Math.floor((W - pad * 2 - (maxPer - 1) * gapCross) / maxPer), 104, 200);
      Wt = Math.max(W, pad * 2 + maxPer * nodeW + (maxPer - 1) * gapCross);
      Ht = pad * 2 + g.layers.length * (nodeH + tagH) + (g.layers.length - 1) * gapMain;
    } else {
      nodeW = compact ? 148 : 172; gapMain = 56; gapCross = 14;
      Wt = Math.max(W, pad * 2 + g.layers.length * nodeW + (g.layers.length - 1) * gapMain);
      Ht = pad * 2 + maxPer * (nodeH + tagH) + (maxPer - 1) * gapCross;
    }
    function box(id) {
      var ps = g.pos[id], n = g.layers[ps.layer].length;
      if (vertical) {
        var rowW = n * nodeW + (n - 1) * gapCross, sx0 = (Wt - rowW) / 2;
        return { x: sx0 + ps.row * (nodeW + gapCross), y: pad + ps.layer * (nodeH + tagH + gapMain) + tagH };
      }
      var colH = n * (nodeH + tagH) + (n - 1) * gapCross, sy0 = (Ht - colH) / 2;
      return { x: pad + ps.layer * (nodeW + gapMain), y: sy0 + ps.row * (nodeH + tagH + gapCross) + tagH };
    }
    var boxes = {};
    Object.keys(g.pos).forEach(function (id) { boxes[id] = box(id); });

    var edgeEls = [], labelEls = [];
    g.layers.forEach(function (ids) {
      ids.forEach(function (id) {
        var a = boxes[id];
        edgesOf(g.byId[id]).forEach(function (e) {
          var b = boxes[e.to];
          if (!b) return;
          var back = g.pos[e.to].layer <= g.pos[id].layer;
          var sx, sy, tx, ty, d;
          if (vertical) {
            sx = a.x + nodeW / 2; sy = a.y + nodeH; tx = b.x + nodeW / 2; ty = b.y - (tags[e.to] ? tagH : 0) - 2;
            d = back ? 'M' + sx + ' ' + sy + 'C' + (sx + nodeW * 0.7) + ' ' + (sy + 30) + ' ' + (tx + nodeW * 0.7) + ' ' + (ty - 30) + ' ' + tx + ' ' + ty
              : 'M' + sx + ' ' + sy + 'C' + sx + ' ' + (sy + gapMain * 0.6) + ' ' + tx + ' ' + (ty - gapMain * 0.6) + ' ' + tx + ' ' + ty;
          } else {
            sx = a.x + nodeW; sy = a.y + nodeH / 2; tx = b.x - 2; ty = b.y + nodeH / 2;
            d = back ? 'M' + sx + ' ' + sy + 'C' + (sx + 40) + ' ' + (sy + nodeH) + ' ' + (tx - 40) + ' ' + (ty + nodeH) + ' ' + tx + ' ' + ty
              : 'M' + sx + ' ' + sy + 'C' + (sx + gapMain * 0.55) + ' ' + sy + ' ' + (tx - gapMain * 0.55) + ' ' + ty + ' ' + tx + ' ' + ty;
          }
          var key = id + '>' + e.to + '>' + e.kind;
          var arrow = vertical
            ? 'M' + (tx - 4) + ' ' + (ty - 6) + 'L' + tx + ' ' + ty + 'L' + (tx + 4) + ' ' + (ty - 6) + 'Z'
            : 'M' + (tx - 6) + ' ' + (ty - 4) + 'L' + tx + ' ' + ty + 'L' + (tx - 6) + ' ' + (ty + 4) + 'Z';
          edgeEls.push(html`<g key=${key}>
            <path d=${d} fill="none" strokeWidth="1.5" strokeDasharray=${back ? '4 3' : null} style=${{ stroke: 'var(--line-strong)' }} />
            <path d=${arrow} style=${{ fill: 'var(--line-strong)' }} />
          </g>`);
          if (e.label) {
            var pc = pctText(edgePct(stats[id], e.kind));
            var text = e.label + (pc ? ' ' + pc : '');
            var lx = (sx + tx) / 2, ly = (sy + ty) / 2, lw = tw(text, 11) + 10;
            labelEls.push(html`<g key=${'l-' + key}>
              <rect x=${lx - lw / 2} y=${ly - 9} width=${lw} height="18" rx="9" strokeWidth="1" style=${{ fill: 'var(--surface)', stroke: 'var(--line)' }} />
              <text x=${lx} y=${ly} textAnchor="middle" dominantBaseline="central" style=${{ fill: 'var(--ink-2)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>${text}</text>
            </g>`);
          }
        });
      });
    });

    var sel = p.selectedId, act = typeof p.onSelect === 'function';
    var maxChars = Math.floor((nodeW - 20) / 6.6);
    var nodeEls = [];
    g.layers.forEach(function (ids, li) {
      ids.forEach(function (id) {
        var s = g.byId[id], b = boxes[id], st = stats[id] || {}, tag = tags[id], isSel = sel === id;
        var statBits = [];
        if (fin(st.inStep)) statBits.push(num(st.inStep) + ' in step');
        if (s.type === 'send' && fin(st.sentToday)) statBits.push(num(st.sentToday) + ' today');
        var statText = statBits.join(' · ');
        var label = 'Step ' + (li + 1) + ': ' + stepKicker(s) + ', ' + stepTitle(s) + (statText ? '. ' + statText : '') + (tag && tag.text ? '. ' + tag.text : '');
        function fire() { if (act) p.onSelect(id, s); }
        var tagName = tag ? agentName(tag.agentId) : '';
        nodeEls.push(html`<g key=${'n-' + id} className=${'ch-flow-node' + (isSel ? ' is-selected' : '')}
            role=${act ? 'button' : 'listitem'} tabIndex=${act ? 0 : null} aria-pressed=${act ? (isSel ? 'true' : 'false') : null} aria-label=${label}
            onClick=${fire} onKeyDown=${function (e) { if (act && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fire(); } }}
            style=${{ cursor: act ? 'pointer' : 'default' }}>
          ${tag ? html`<g>
              <rect x=${b.x} y=${b.y - tagH + 1} width=${Math.min(nodeW, tw(trunc(tag.text || tagName, maxChars + 4), 10) + 22)} height=${tagH - 4} rx="7" style=${{ fill: 'var(--agent-soft)' }} />
              <circle cx=${b.x + 8} cy=${b.y - tagH + 1 + (tagH - 4) / 2} r="3" style=${{ fill: 'var(--agent)' }} />
              <text x=${b.x + 15} y=${b.y - tagH + 1 + (tagH - 4) / 2} dominantBaseline="central" style=${{ fill: 'var(--agent)', fontSize: 10, fontWeight: 600 }}>${trunc(tag.text || tagName, maxChars + 4)}</text>
              <title>${(tagName ? tagName + ': ' : '') + (tag.text || '')}</title>
            </g>` : null}
          <rect x=${b.x} y=${b.y} width=${nodeW} height=${nodeH} rx="6" strokeWidth=${isSel ? 2 : 1}
            style=${{ fill: isSel ? 'var(--accent-soft)' : 'var(--surface)', stroke: isSel ? 'var(--accent)' : (tag ? 'var(--agent)' : 'var(--line-strong)') }} />
          <text x=${b.x + 12} y=${b.y + 15} style=${{ fill: 'var(--ink-3)', fontSize: 11, fontWeight: 500 }}>${trunc(stepKicker(s), maxChars + 2)}</text>
          <text x=${b.x + 12} y=${b.y + 32} style=${{ fill: 'var(--ink)', fontSize: 12, fontWeight: 600 }}>${trunc(stepTitle(s), maxChars)}</text>
          ${!compact && statText ? html`<text x=${b.x + 12} y=${b.y + 50} style=${{ fill: 'var(--ink-2)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>${trunc(statText, maxChars + 2)}</text>` : null}
          <title>${label}</title>
        </g>`);
      });
    });

    return html`<div ref=${ref} className=${'ch-flow k-scroll-x' + (vertical ? ' is-vertical' : '')} style=${{ overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
      <svg role=${act ? 'group' : 'list'} aria-label=${aria} viewBox=${'0 0 ' + Wt + ' ' + Ht} width=${Wt} height=${Ht} style=${{ display: 'block', minWidth: Wt }}>
        <title>${aria}</title>
        ${edgeEls}
        ${labelEls}
        ${nodeEls}
      </svg>
    </div>`;
  }

  var AGENT_NAMES = {
    optimizer: 'Variant Optimizer', sendtime: 'Send-Time Tuner', pacer: 'Budget Pacer', guard: 'Fatigue Guard',
    analyst: 'Insight Analyst', copy: 'Copy Drafter', scout: 'Segment Scout', planner: 'Campaign Planner'
  };
  function agentName(id) {
    if (!id) return '';
    try {
      var d = MC.runtime && typeof MC.runtime.def === 'function' ? MC.runtime.def(id) : null;
      if (d && d.name) return d.name;
    } catch (e) { /* fallback */ }
    return AGENT_NAMES[id] || String(id);
  }

  /* ================= Gantt ================= */
  var STATUS = {
    draft: { label: 'Draft', fill: 'var(--surface-2)', stroke: 'var(--line-strong)', dash: '4 3', text: 'var(--ink-2)' },
    scheduled: { label: 'Scheduled', fill: 'var(--accent-soft)', stroke: 'var(--accent)', dash: null, text: 'var(--ink)' },
    live: { label: 'Live', fill: 'var(--accent)', stroke: 'var(--accent)', dash: null, text: 'var(--on-accent)' },
    paused: { label: 'Paused', fill: 'var(--warn-soft)', stroke: 'var(--warn)', dash: null, text: 'var(--ink)' },
    completed: { label: 'Completed', fill: 'var(--line)', stroke: 'var(--line-strong)', dash: null, text: 'var(--ink-2)' }
  };
  var STATUS_ORDER = ['live', 'scheduled', 'paused', 'draft', 'completed'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function cal(d) {
    var n = Math.floor(d) + 310, y = 2026, guard = 0;
    while (n < 0 && guard++ < 50) { y--; n += isLeap(y) ? 366 : 365; }
    while (n >= (isLeap(y) ? 366 : 365) && guard++ < 100) { n -= isLeap(y) ? 366 : 365; y++; }
    var ml = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], m = 0;
    while (m < 11 && n >= ml[m]) { n -= ml[m]; m++; }
    return { y: y, m: m, d: n + 1 };
  }
  function dayLabel(d) { var c = cal(d); return MONTHS[c.m] + ' ' + c.d; }
  function stampLabel(t) {
    try { if (MC.fmt && typeof MC.fmt.stamp === 'function') { var s = MC.fmt.stamp(t); if (s) return s; } } catch (e) { /* local */ }
    var h = ((t % 24) + 24) % 24;
    return dayLabel(Math.floor(t / 24)) + ' · ' + (h < 10 ? '0' : '') + h + ':00';
  }

  function Gantt(p) {
    var React = R();
    var ref = React.useRef(null);
    var u = U();
    var wRaw = u ? u.useChartWidth(ref) : 0;
    var W = Math.max(720, wRaw > 0 ? wRaw : 720);
    var perDay = p.unit === 'day' ? 1 : 24;
    var rows = (p.rows || []).filter(function (r) { return r && r.id != null; });
    var starts = rows.map(function (r) { return r.start; }).filter(fin), ends = rows.map(function (r) { return r.end; }).filter(fin);
    var from = fin(p.from) ? p.from : (starts.length ? Math.min.apply(null, starts) : 0);
    var to = fin(p.to) ? p.to : (ends.length ? Math.max.apply(null, ends) : from + 30 * perDay);
    if (!(to > from)) to = from + perDay;
    var act = typeof p.onSelect === 'function';
    var aria = p.ariaLabel || ('Campaign calendar from ' + dayLabel(from / perDay) + ' to ' + dayLabel(to / perDay) + ', ' + rows.length + ' campaigns');

    var labW = clamp(Math.max.apply(null, [80].concat(rows.map(function (r) { return tw(r.label, 12); }))) + 16, 110, 190);
    var x0 = labW, x1 = W - 12;
    function sx(t) { return x0 + (t - from) / (to - from) * (x1 - x0); }
    var headH = 36, rowH = 34, barH = 18;
    var markers = (p.markers || []).filter(function (m) { return m && fin(m.x) && m.x >= from && m.x <= to; });
    var footH = 22 + (markers.length ? 30 : 0);
    var Ht = headH + Math.max(1, rows.length) * rowH + footH;

    var d0 = Math.ceil(from / perDay), d1 = Math.floor(to / perDay);
    var grid = [], monthEls = [];
    var lastMonthX = -999;
    for (var d = d0; d <= d1 && grid.length < 400; d++) {
      var c = cal(d), x = sx(d * perDay);
      var monday = (((d % 7) + 7) % 7) === 2;
      if (c.d === 1 || d === d0) {
        if (x - lastMonthX > 40) {
          monthEls.push(html`<text key=${'m' + d} x=${x + 3} y="12" style=${{ fill: 'var(--ink)', fontSize: 12, fontWeight: 600 }}>${MONTHS[c.m] + (c.m === 0 || d === d0 ? ' ' + c.y : '')}</text>`);
          lastMonthX = x;
        }
        if (c.d === 1) grid.push(html`<line key=${'mg' + d} x1=${x} x2=${x} y1="0" y2=${Ht - footH} strokeWidth="1" style=${{ stroke: 'var(--line-strong)' }} />`);
      }
      if (monday) {
        grid.push(html`<g key=${'w' + d}>
          <line x1=${x} x2=${x} y1=${headH - 14} y2=${Ht - footH} strokeWidth="1" style=${{ stroke: 'var(--chart-grid)' }} />
          <text x=${x + 3} y=${headH - 4} style=${{ fill: 'var(--ink-3)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>${c.d}</text>
        </g>`);
      }
    }

    var rowEls = rows.map(function (r, i) {
      var y = headH + i * rowH, st = STATUS[r.status] || STATUS.draft, isSel = p.selectedId === r.id;
      var s = fin(r.start) ? r.start : from, e = fin(r.end) ? r.end : s + perDay;
      var bx0 = sx(clamp(s, from, to)), bx1 = sx(clamp(e, from, to)), visible = e > from && s < to;
      var bw = Math.max(3, bx1 - bx0);
      var txt = st.label, fits = tw(txt, 11) + 12 < bw;
      var range = dayLabel(s / perDay) + ' to ' + dayLabel(e / perDay);
      var label = r.label + ', ' + st.label.toLowerCase() + ', ' + range;
      function fire() { if (act) p.onSelect(r.id, r); }
      return html`<g key=${'r-' + r.id} role=${act ? 'button' : 'listitem'} tabIndex=${act ? 0 : null} aria-label=${label}
          aria-pressed=${act ? (isSel ? 'true' : 'false') : null}
          onClick=${fire} onKeyDown=${function (ev) { if (act && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); fire(); } }}
          style=${{ cursor: act ? 'pointer' : 'default' }}>
        <rect x="0" y=${y} width=${W} height=${rowH} style=${{ fill: isSel ? 'var(--accent-soft)' : 'transparent', fillOpacity: isSel ? 0.7 : 1 }} />
        <text x="8" y=${y + rowH / 2} dominantBaseline="central" style=${{ fill: 'var(--ink)', fontSize: 12, fontWeight: isSel ? 600 : 500 }}>${trunc(r.label, Math.floor((labW - 16) / 6.8))}</text>
        ${visible ? html`<g>
            <rect x=${bx0} y=${y + (rowH - barH) / 2} width=${bw} height=${barH} rx="4" strokeWidth="1" strokeDasharray=${st.dash}
              style=${{ fill: st.fill, stroke: st.stroke }} />
            ${fits ? html`<text x=${bx0 + 6} y=${y + rowH / 2} dominantBaseline="central" style=${{ fill: st.text, fontSize: 11, fontWeight: 500 }}>${txt}</text>` : null}
          </g>` : html`<text x=${s >= to ? x1 : x0 + 4} y=${y + rowH / 2} textAnchor=${s >= to ? 'end' : 'start'} dominantBaseline="central" style=${{ fill: 'var(--ink-3)', fontSize: 11 }}>${s >= to ? 'Starts later' : 'Ended earlier'}</text>`}
        <title>${label}</title>
      </g>`;
    });

    var nowX = fin(p.now) && p.now >= from && p.now <= to ? sx(p.now) : null;
    var footY = Ht - footH;
    var mEls = markers.map(function (m, k) {
      var x = sx(m.x), ly = footY + 30 + (k % 2) * 12 - (markers.length ? 0 : 0);
      return html`<g key=${'mk-' + m.x + '-' + k}>
        <line x1=${x} x2=${x} y1=${headH} y2=${footY + 20 + (k % 2) * 12} strokeWidth="1" strokeDasharray="2 3" style=${{ stroke: 'var(--ink-3)' }} />
        <text x=${x} y=${ly} textAnchor=${x > x1 - 60 ? 'end' : 'middle'} style=${{ fill: 'var(--ink-2)', fontSize: 10 }}>${m.label}</text>
      </g>`;
    });

    var present = STATUS_ORDER.filter(function (k) { return rows.some(function (r) { return (STATUS[r.status] ? r.status : 'draft') === k; }); });
    var Legend = MC.charts.Legend;
    var legendItems = present.map(function (k) { return { key: k, label: STATUS[k].label, color: (k === 'draft' ? STATUS[k].stroke : STATUS[k].fill).replace(/^var\(|\)$/g, '') }; });
    var table = {
      columns: [{ key: 'l', label: 'Campaign', align: 'left' }, { key: 's', label: 'Status', align: 'left' }, { key: 'a', label: 'Starts', align: 'left' }, { key: 'b', label: 'Ends', align: 'left' }],
      rows: rows.map(function (r) {
        return { _key: String(r.id), l: r.label, s: (STATUS[r.status] || STATUS.draft).label, a: fin(r.start) ? stampLabel(perDay === 24 ? r.start : r.start * 24) : DASH, b: fin(r.end) ? stampLabel(perDay === 24 ? r.end : r.end * 24) : DASH };
      })
    };
    var tableState = React.useState(false), showTable = tableState[0], setShowTable = tableState[1];
    var TableView = u ? u.TableView : null;

    return html`<div className="ch ch-gantt" style=${{ minWidth: 0 }}>
      <div className="ch-head" style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        ${Legend && legendItems.length ? html`<${Legend} items=${legendItems} />` : html`<span></span>`}
        ${TableView ? html`<button type="button" className="ch-toggle" aria-pressed=${showTable ? 'true' : 'false'} onClick=${function () { setShowTable(!showTable); }}
          style=${{ font: 'inherit', fontSize: 12, color: 'var(--accent)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', minHeight: 28, cursor: 'pointer', marginLeft: 'auto' }}>${showTable ? 'View as chart' : 'View as table'}</button>` : null}
      </div>
      <div ref=${ref} className="k-scroll-x" style=${{ overflowX: 'auto', maxWidth: '100%' }}>
        ${showTable && TableView ? html`<${TableView} table=${table} caption=${aria} />` : html`
        <svg role=${act ? 'group' : 'list'} aria-label=${aria} viewBox=${'0 0 ' + W + ' ' + Ht} width=${W} height=${Ht} style=${{ display: 'block', minWidth: 720 }}>
          <title>${aria}</title>
          ${monthEls}
          <line x1="0" x2=${W} y1=${headH} y2=${headH} strokeWidth="1" style=${{ stroke: 'var(--line-strong)' }} />
          ${rows.length ? null : html`<text x=${x0 + 8} y=${headH + rowH / 2} dominantBaseline="central" style=${{ fill: 'var(--ink-3)', fontSize: 12 }}>No campaigns in this period yet.</text>`}
          ${grid}
          ${rowEls}
          ${mEls}
          ${nowX != null ? html`<g pointerEvents="none">
              <line x1=${nowX} x2=${nowX} y1=${headH - 6} y2=${footY + 4} strokeWidth="2" style=${{ stroke: 'var(--accent)' }} />
              <text x=${nowX + (nowX > x1 - 120 ? -4 : 4)} y=${footY + 16} textAnchor=${nowX > x1 - 120 ? 'end' : 'start'} style=${{ fill: 'var(--accent)', fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${'Now · ' + stampLabel(perDay === 24 ? p.now : p.now * 24)}</text>
            </g>` : null}
        </svg>`}
      </div>
    </div>`;
  }

  MC.charts.FlowDiagram = FlowDiagram;
  MC.charts.Gantt = Gantt;
})();
