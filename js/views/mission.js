/* Marketing Cloud - the Mission room (#missions, #missions/<id>): MC.views.missions.
   The product's home. A live board, not a playback: everything here is rendered from the current store state
   (world.missions, the campaigns/segments/variants the missions made, engine metrics) and re-renders as the engine
   ticks and agents act. Nothing is scripted or timed: lanes are agents, blocks are the mission's real steps laid out
   by dependency, wires are the steps' real `needs`, the baton chip is the real output a finished step is handing on,
   cursors show only while a step is genuinely working, and the ask waits for a person. A just-changed element gets a
   brief highlight (<= 320 ms) so the eye catches it. Routes: #missions and #missions/<id> (id read from the hash or
   props.id; the room keeps the hash in step with history.replaceState, which never fires hashchange). */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};

  var DASH = '–', DOT = '·';
  var EMPTY = [];
  var ROW_H = 76, BLOCK_H = 46, LABEL_W = 176, LABEL_W_NARROW = 112, MIN_COL = 128;

  function html() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function cx() { var o = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function num(n) { return fin(n) ? (MC.fmt && MC.fmt.num ? MC.fmt.num(Math.round(n)) : String(Math.round(n))) : DASH; }
  function money(n, compact) { return fin(n) ? (MC.fmt && MC.fmt.money ? MC.fmt.money(n, compact && Math.abs(n) >= 10000 ? { compact: true } : undefined) : '$' + Math.round(n)) : DASH; }
  function L() { return MC.lead || {}; }
  function lcFirst(s) { s = String(s || ''); return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
  function agentName(id) { return L().agentName ? L().agentName(id) : (MC.ui && MC.ui.agentName ? MC.ui.agentName(id) : id); }
  function Mark(p) { var C = MC.ui && MC.ui.AgentMark; return C ? html`<${C} id=${p.id} size=${p.size || 14} badge=${p.badge} />` : null; }
  function dayShort(d) { try { return L().dayShort(d); } catch (e) { return 'day ' + d; } }
  function getWorld() { return MC.store && MC.store.getState ? MC.store.getState() : null; }

  /* ======================= selectors over the live world ======================= */
  function campaignOf(w, m) {
    var arts = m.artifacts || EMPTY, i, id = null;
    for (i = 0; i < arts.length; i++) if (arts[i].kind === 'campaign' && w.campaigns.byId[arts[i].id]) { id = arts[i].id; break; }
    if (!id && m.data && m.data.campaignId && w.campaigns.byId[m.data.campaignId]) id = m.data.campaignId;
    return id ? w.campaigns.byId[id] : null;
  }
  function campaignIds(w, m) {
    var out = [];
    (m.artifacts || EMPTY).forEach(function (a) { if (a.kind === 'campaign' && w.campaigns.byId[a.id]) out.push(a.id); });
    if (!out.length && m.data && m.data.campaignId && w.campaigns.byId[m.data.campaignId]) out.push(m.data.campaignId);
    return out;
  }
  function segmentOf(w, m) {
    var arts = m.artifacts || EMPTY, i;
    for (i = 0; i < arts.length; i++) if (arts[i].kind === 'segment' && w.segments.byId[arts[i].id]) return w.segments.byId[arts[i].id];
    return null;
  }
  // Engine totals for the mission's campaigns: sent, delivered, revenue, cost, conversions.
  function totalsOf(w, cids) {
    var F = MC.F, out = { sent: 0, deliv: 0, rev: 0, cost: 0, conv: 0 }, days = (w.metrics && w.metrics.days) || EMPTY;
    for (var i = 0; i < days.length; i++) {
      var c = days[i] && days[i].c;
      if (!c) continue;
      for (var k = 0; k < cids.length; k++) {
        var cd = c[cids[k]];
        if (!cd || !cd.tot) continue;
        out.sent += cd.tot[F.SENT] || 0; out.deliv += cd.tot[F.DELIV] || 0; out.rev += cd.tot[F.REV] || 0;
        out.cost += cd.tot[F.COST] || 0; out.conv += cd.tot[F.CONV] || 0;
      }
    }
    return out;
  }
  function openAsks(m) { return (m.asks || EMPTY).filter(function (a) { return a.status === 'open'; }); }
  function progressOf(w, m) {
    try { var p = MC.missions.progressOf(w, m, w.meta.tick); if (p) return p; } catch (e) { /* use stored */ }
    return m.progress || { value: 0, target: m.objective.target };
  }
  function workingSteps(m) { return (m.plan || EMPTY).filter(function (s) { return s.status === 'working'; }); }

  /* ---- board layout: columns by dependency depth, rows by agent (first appearance) ---- */
  function layout(m) {
    var plan = m.plan || EMPTY, byId = {}, col = {}, i, pass;
    plan.forEach(function (s) { byId[s.id] = s; });
    for (pass = 0; pass < plan.length + 1; pass++) {
      var changed = false;
      for (i = 0; i < plan.length; i++) {
        var s = plan[i], c = 0;
        (s.needs || EMPTY).forEach(function (n) { if (byId[n]) c = Math.max(c, (col[n] === undefined ? 0 : col[n]) + 1); });
        if (col[s.id] !== c) { col[s.id] = c; changed = true; }
      }
      if (!changed) break;
    }
    var rows = [], rowOf = {}, taken = {};
    plan.forEach(function (s) { if (rowOf[s.agentId] === undefined) { rowOf[s.agentId] = rows.length; rows.push(s.agentId); } });
    var cells = {}, ncols = 1;
    plan.slice().sort(function (a, b) { return col[a.id] - col[b.id]; }).forEach(function (s) {
      var c = col[s.id];
      while (taken[s.agentId + '|' + c]) c++;
      taken[s.agentId + '|' + c] = true;
      cells[s.id] = { col: c, row: rowOf[s.agentId] };
      ncols = Math.max(ncols, c + 1);
    });
    return { rows: rows, cells: cells, ncols: ncols, byId: byId };
  }

  // The real output a finished step hands on: short chip text and a full description.
  function payloadOf(w, m, s) {
    var art = s.artifact, c = campaignOf(w, m), seg, vs;
    if (art && art.kind === 'segment' && w.segments.byId[art.id]) { seg = w.segments.byId[art.id]; return { short: num(seg.count) + ' people', full: seg.name + ': ' + num(seg.count) + ' people' }; }
    if (art && art.kind === 'campaign' && w.campaigns.byId[art.id]) { return { short: 'Campaign draft', full: w.campaigns.byId[art.id].name }; }
    if (c && s.kind === 'copy') { vs = MC.catalog.variantsOf(w, c.id); return { short: vs.length + (vs.length === 1 ? ' message' : ' messages'), full: vs.length + ' messages written for ' + c.name }; }
    if (c && (s.kind === 'pacer' || s.kind === 'budget')) return { short: money(c.budget.total) + ' split', full: money(c.budget.total) + ' split across ' + c.channels.length + ' channels' };
    if (s.kind === 'sendtime') return { short: 'Send windows', full: s.note || 'Send windows set' };
    if (s.kind === 'guard') return { short: 'Rested list', full: s.note || 'Over-messaged people rested' };
    if (s.kind === 'handoff') return { short: 'For sign-off', full: s.note || 'Ready for your sign-off' };
    return { short: trunc(s.note || s.title, 18), full: s.note || s.title };
  }

  /* ---- the one live sentence under the goal ---- */
  var NOUN = { reactivations: 'win-back', revenue: 'campaign', orders: 'campaign', signups: 'sign-up push', unsubs: 'list-protection plan' };
  function statusSentence(w, m, tot, seg, camp) {
    var out = [], size = seg ? seg.count : (m.data && m.data.audience && fin(m.data.audience.size) ? m.data.audience.size : null);
    var noun = NOUN[m.objective.metric] || 'campaign', asks = openAsks(m), work = workingSteps(m);
    function B(v) { return { b: v }; }
    if (m.status === 'stopped') return ['Stopped. Everything the team made stays where it is.'];
    if (m.status === 'done') return ['Finished. ', B(money(tot.rev)), ' came back against ', B(money(tot.cost)), ' spent.'];
    if (camp) {
      if (size !== null) out.push(B(num(size)), ' people are in the ' + noun + '. ');
      if (tot.sent > 0) {
        out.push(B(num(tot.sent)), ' messages are out; ', B(money(tot.rev)), ' back against ', B(money(tot.cost)), ' spent.');
      } else out.push(camp.status === 'draft' ? 'The campaign is drafted and waiting for sign-off.' : 'Nothing has sent yet.');
    } else if (size !== null) {
      out.push(B(num(size)), ' people found so far. ');
      if (work[0]) out.push(agentName(work[0].agentId) + ' is ' + lcFirst(work[0].title) + '.');
    } else if (work[0]) out.push(agentName(work[0].agentId) + ' is ' + lcFirst(work[0].title) + '.');
    else out.push('The plan is forming.');
    if (asks.length) out.push(' One decision needs you.');
    return out;
  }

  /* ======================= small hooks ======================= */
  function useStoreTick() {
    // re-render on every store change; read the world directly inside render
    return MC.hooks.useSelect(function () { return MC.store.version(); });
  }
  // Brief highlight for keys whose signature changed since the last render (<= 320 ms).
  function useFlash(scope, sig) {
    var React = R(), ref = React.useRef(null), st = React.useState(EMPTY_OBJ), flash = st[0], setFlash = st[1];
    var key = JSON.stringify(sig);
    React.useEffect(function () {
      var prev = ref.current;
      ref.current = { scope: scope, sig: sig };
      if (!prev || prev.scope !== scope) { setFlash(EMPTY_OBJ); return undefined; }
      var ch = {}, any = false;
      Object.keys(sig).forEach(function (k) { if (prev.sig[k] !== sig[k]) { ch[k] = 1; any = true; } });
      if (!any) return undefined;
      setFlash(ch);
      var t = window.setTimeout(function () { setFlash(EMPTY_OBJ); }, 320);
      return function () { window.clearTimeout(t); };
    }, [scope, key]);
    return flash;
  }
  var EMPTY_OBJ = {};
  function Live(p) {
    // a number that gets a brief highlight when its value changes
    var React = R(), prev = React.useRef(p.value), st = React.useState(false);
    React.useEffect(function () {
      if (prev.current === p.value) return undefined;
      prev.current = p.value;
      st[1](true);
      var t = window.setTimeout(function () { st[1](false); }, 320);
      return function () { window.clearTimeout(t); };
    }, [p.value]);
    return html`<b className=${cx('mr-live', st[0] && 'is-bump', p.className)}>${p.text}</b>`;
  }
  function hashId() {
    var m = /^#?\/?missions\/([^/?]+)/.exec(window.location.hash || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* ======================= pieces ======================= */
  function Switcher(p) {
    var w = p.world, tick = w.meta.tick;
    return html`<nav className="mr-switch" aria-label="Missions">
      <ul className="mr-switch-list">
        ${p.missions.map(function (m) {
          var pr = progressOf(w, m), frac = pr.target > 0 ? clamp(pr.value / pr.target, 0, 1) : 0;
          var work = workingSteps(m), asks = openAsks(m), cur = m.id === p.currentId;
          var seen = {}, agents = work.filter(function (s) { if (seen[s.agentId]) return false; seen[s.agentId] = 1; return true; }).slice(0, 4);
          return html`<li key=${m.id}><button type="button" className=${cx('mr-tab', cur && 'is-current', asks.length && 'has-ask')} aria-current=${cur ? 'true' : undefined}
              onClick=${function () { p.onPick(m.id); }}>
            <span className="mr-tab-goal">${m.goalText}</span>
            <span className="mr-tab-bar" aria-hidden="true"><i style=${{ width: (frac * 100).toFixed(1) + '%' }}></i></span>
            <span className="mr-tab-meta">
              <span className="mr-tab-who">${agents.length ? agents.map(function (s) { return html`<${Mark} key=${s.agentId} id=${s.agentId} size=${13} />`; }) : null}
                <span>${m.status === 'done' ? 'Done' : m.status === 'paused' ? 'Paused' : m.status === 'stopped' ? 'Stopped' : agents.length ? agentName(agents[0].agentId) + (agents.length > 1 ? ' +' + (agents.length - 1) : '') : asks.length ? 'Waiting on you' : m.phase === 'monitoring' ? 'Monitoring' : 'Planning'}</span></span>
              ${asks.length ? html`<span className="mr-tab-ask">${asks.length > 1 ? asks.length + ' asks' : '1 ask'} for you</span>` : html`<span className="mr-tab-pct">${Math.round(frac * 100)}%</span>`}
            </span>
          </button></li>`;
        })}
      </ul>
      <button type="button" className="mr-newgoal" onClick=${p.onNew}>New goal</button>
    </nav>`;
  }

  function Meta(p) {
    var w = p.world, m = p.m, o = m.objective, pr = p.progress, left = o.by - MC.time.dayOf(w.meta.tick);
    var cons = (o.constraints || EMPTY).map(function (c) { return L().constraintLabel ? L().constraintLabel(c) : c.kind; });
    var noun = L().metricNoun ? L().metricNoun(o.metric) : o.metric;
    return html`<dl className="mr-meta">
      <div><dt>Deadline</dt><dd>${dayShort(o.by)}<span> ${DOT} ${left > 0 ? left + (left === 1 ? ' day left' : ' days left') : left === 0 ? 'last day' : 'past'}</span></dd></div>
      <div><dt>Limits</dt><dd>${cons.length ? cons.join(', ') : 'None set'}</dd></div>
      <div><dt>Target</dt><dd>${L().fmtMetric ? L().fmtMetric(o.metric, o.target) : num(o.target)} ${noun}<span> ${DOT} ${L().fmtMetric ? L().fmtMetric(o.metric, pr.value) : num(pr.value)} so far</span></dd></div>
    </dl>`;
  }

  function Block(p) {
    var s = p.step, pos = p.pos, st = s.status, frac = 0;
    if (st === 'working') frac = clamp((p.tick - (s.startedTick || p.tick)) / ((MC.missions.DUR && MC.missions.DUR[s.kind]) || 6), 0.05, 1);
    var label = st === 'done' ? 'done' : st === 'working' ? 'working' : st === 'blocked' ? 'waiting on you' : st === 'skipped' ? 'skipped' : 'queued';
    return html`<div className=${cx('mr-blk', 's-' + st, p.flash && 'is-flash')} role="listitem" title=${s.note || s.title}
        aria-label=${agentName(s.agentId) + ': ' + s.title + ', ' + label}
        style=${{ left: pos.x + 'px', top: pos.y + 'px', width: pos.w + 'px', height: BLOCK_H + 'px' }}>
      <span className="mr-blk-t">${s.title}</span>
      ${st === 'working' ? html`<i className="mr-blk-fill" style=${{ width: (frac * 100).toFixed(0) + '%' }}></i>` : null}
    </div>`;
  }

  function Board(p) {
    var React = R(), m = p.m, w = p.world, lay = p.lay, ref = React.useRef(null);
    var avail = MC.hooks.useWidth(ref);
    var narrow = avail > 0 && avail < 640, lw = narrow ? LABEL_W_NARROW : LABEL_W;
    var stageAvail = Math.max(0, avail - lw);
    var colW = Math.max(MIN_COL, lay.ncols ? stageAvail / lay.ncols : MIN_COL);
    var gap = clamp(colW * 0.3, 34, 62), blockW = colW - gap, stageW = colW * lay.ncols;
    var H = lay.rows.length * ROW_H, tick = w.meta.tick;
    function pos(s) { var c = lay.cells[s.id]; return { x: c.col * colW, y: c.row * ROW_H + (ROW_H - BLOCK_H) / 2 - 6, w: blockW }; }
    var wires = [], chips = [], seenChip = {};
    (m.plan || EMPTY).forEach(function (s) {
      (s.needs || EMPTY).forEach(function (nid) {
        var src = lay.byId[nid];
        if (!src || !lay.cells[nid] || !lay.cells[s.id]) return;
        var a = pos(src), b = pos(s), x1 = a.x + a.w, y1 = a.y + BLOCK_H / 2, x2 = b.x, y2 = b.y + BLOCK_H / 2;
        var xm = x2 - Math.min(14, gap / 2), r = 6, sg = y2 >= y1 ? 1 : -1, d;
        if (xm < x1 + r) xm = x1 + r;
        if (Math.abs(y2 - y1) < 2 * r) d = 'M' + x1 + ' ' + y1 + 'H' + x2;
        else d = 'M' + x1 + ' ' + y1 + 'H' + (xm - r) + 'Q' + xm + ' ' + y1 + ' ' + xm + ' ' + (y1 + sg * r) + 'V' + (y2 - sg * r) + 'Q' + xm + ' ' + y2 + ' ' + (xm + r) + ' ' + y2 + 'H' + x2;
        var active = src.status === 'done' && s.status !== 'done' && s.status !== 'skipped';
        wires.push({ k: nid + '>' + s.id, d: d, active: active, blocked: s.status === 'blocked' });
        if (active && !seenChip[nid]) { seenChip[nid] = 1; chips.push({ k: nid, x: a.x, y: a.y + BLOCK_H + 2, p: payloadOf(w, m, src), from: src.agentId, to: s.agentId }); }
      });
    });
    return html`<div className="mr-scroll" data-tour="lanes" ref=${ref} role="region" aria-label="Agent team board" tabIndex="0">
      <div className="mr-lanes" style=${{ width: (lw + stageW) + 'px', minWidth: '100%' }}>
        <svg className="mr-wires" aria-hidden="true" width=${stageW} height=${H} style=${{ left: lw + 'px' }}>
          ${wires.map(function (x) { return html`<path key=${x.k} d=${x.d} className=${cx(x.active && 'is-active')} />`; })}
        </svg>
        ${lay.rows.map(function (aid, ri) {
          var mine = (m.plan || EMPTY).filter(function (s) { return s.agentId === aid; });
          var cur = mine.filter(function (s) { return s.status === 'working'; })[0], bl = mine.filter(function (s) { return s.status === 'blocked'; })[0];
          var allDone = mine.every(function (s) { return s.status === 'done' || s.status === 'skipped'; });
          var state = cur ? 'work' : bl ? 'wait' : allDone ? 'ok' : 'idle';
          var line = cur ? cur.title : bl ? 'Waiting on you' : allDone ? (m.phase === 'monitoring' && aid === 'analyst' ? 'Tracking daily' : 'Done') : (function () { var q = mine.filter(function (s) { return s.status === 'queued'; })[0]; return q ? 'Next: ' + lcFirst(q.title) : 'Idle'; })();
          return html`<div key=${aid} className=${cx('mr-lane', 'is-' + state)} style=${{ height: ROW_H + 'px' }}>
            <div className="mr-who" style=${{ width: lw + 'px' }}>
              <span className="mr-led" aria-hidden="true"></span>
              <span className="mr-who-tx"><span className="mr-nm"><${Mark} id=${aid} size=${14} />${agentName(aid)}</span>
                ${narrow ? null : html`<span className="mr-st">${line}</span>`}</span>
            </div>
          </div>`;
        })}
        <div className="mr-stage" role="list" aria-label="Steps" style=${{ left: lw + 'px', width: stageW + 'px', height: H + 'px' }}>
          ${(m.plan || EMPTY).map(function (s) { return lay.cells[s.id] ? html`<${Block} key=${s.id} step=${s} pos=${pos(s)} tick=${tick} flash=${p.flash[s.id]} />` : null; })}
          ${chips.map(function (c) {
            return html`<span key=${'c' + c.k} className="mr-baton" style=${{ left: (c.x + 4) + 'px', top: c.y + 'px', maxWidth: Math.max(blockW + gap - 8, 120) + 'px' }}
              title=${agentName(c.from) + ' hands ' + c.p.full + ' to ' + agentName(c.to)}>${c.p.short}</span>`;
          })}
        </div>
      </div>
    </div>`;
  }

  function AskCard(p) {
    var ask = p.ask, m = p.m, im = ask.impact || {}, metric = im.metric || '';
    var hasImpact = fin(im.lo) && fin(im.hi) && (im.lo || im.hi);
    var more = p.count > 1 ? ' (' + (p.count - 1) + ' more after this)' : '';
    return html`<section className="mr-ask" data-tour="ask" aria-labelledby="mr-ask-q" aria-describedby="mr-ask-why">
      <p className="mr-ask-who"><${Mark} id=${ask.agentId} size=${13} /> ${agentName(ask.agentId)} needs a decision${more}. ${ask.blocking !== false ? 'The rest of the team keeps going where it can.' : 'Nothing is held up.'}</p>
      <h2 id="mr-ask-q">${ask.question}</h2>
      <div className="mr-ask-grid">
        ${hasImpact ? html`<div><span className="k">If you agree</span><b>${num(im.lo)} to ${num(im.hi)}</b><small>${metric || 'expected change'}</small></div>` : null}
        <div><span className="k">Suggested</span><b>${ask.default}</b><small>Nothing happens until you choose</small></div>
        ${ask.blocking !== false ? html`<div><span className="k">Held up</span><b>${(function () { var st = (m.plan || EMPTY).filter(function (s) { return s.status === 'blocked'; }); return st.length ? st.length + (st.length === 1 ? ' step' : ' steps') : 'Nothing yet'; })()}</b><small>until you answer</small></div>` : null}
      </div>
      <p id="mr-ask-why" className="mr-ask-why">${ask.why}</p>
      <div className="mr-ask-act">
        ${ask.options.map(function (o) {
          return html`<button key=${o} type="button" className=${cx('mr-ask-btn', o === ask.default && 'go')} disabled=${p.busy} onClick=${function () { p.onAnswer(ask, o); }}>${o}</button>`;
        })}
      </div>
      ${p.error ? html`<p className="mr-ask-err" role="alert">${p.error}</p>` : null}
    </section>`;
  }

  /* ---- artifact panels ---- */
  function Panel(p) {
    var C = MC.ui && MC.ui.AgentCursor;
    return html`<article className=${cx('mr-art', !p.ready && 'is-wait', p.flash && 'is-flash')} aria-label=${p.title}>
      <header><h3>${p.title}</h3><span className="by"><${Mark} id=${p.agent} size=${12} />${agentName(p.agent)}</span></header>
      ${p.ready ? html`<div className="mr-art-body">${p.children}</div>` : html`<p className="mr-art-ph">${p.working ? agentName(p.agent) + ' is on it.' : 'Waiting on ' + agentName(p.agent)}</p>`}
      ${p.working && C ? html`<${C} id=${p.agent} className="mr-cursor" style=${{ right: 18, bottom: 16 }} />` : null}
    </article>`;
  }
  function SegmentPanel(p) {
    var seg = p.seg, count = seg ? seg.count : 0, dots = clamp(Math.round(count), 0, 200), per = count > dots ? count / dots : 1;
    var aud = p.m.data && p.m.data.audience, share = aud && aud.size > 0 && fin(aud.reach) ? clamp(aud.reach / aud.size, 0, 1) : 1;
    var lit = Math.round(dots * share), items = [];
    for (var i = 0; i < dots; i++) items.push(html`<i key=${i} className=${i < lit ? '' : 'out'}></i>`);
    return html`<div className="mr-seg-n"><${Live} value=${count} text=${num(count)} /><span>${seg ? lcFirst(seg.name) : ''}</span></div>
      <div className="mr-dots" aria-hidden="true">${items}</div>
      <p className="mr-art-note">${per > 1 ? '1 dot is about ' + Math.round(per) + ' people. ' : ''}${share < 1 ? 'Hollow dots can’t be reached by ' + (aud.primary || 'email') + '.' : 'Everyone here can be reached.'}</p>`;
  }
  function vtext(v) { var f = v.fields || {}; return f.subject || f.pushTitle || f.socialHeadline || f.sms || f.pushBody || f.socialText || f.body || ''; }
  function EmailPanel(p) {
    var Scene = MC.ui && MC.ui.Scene, vs = p.variants, v = vs.filter(function (x) { return x.channel === 'email'; })[0] || vs[0], f = v.fields || {};
    var isText = v.channel !== 'email';
    return html`<div className="mr-mail">
      ${isText ? html`<div className="mr-sms">${vtext(v)}</div>` : html`
        <div className="mr-m-bar">${p.brand}</div>
        ${Scene && f.imageId ? html`<${Scene} imageId=${f.imageId} style=${{ borderRadius: 0, height: 50, width: '100%', objectFit: 'cover' }} />` : null}
        <p className="mr-m-h">${f.headline || f.subject}</p>
        <p className="mr-m-b">${trunc(f.body, 110)}</p>
        ${f.cta ? html`<span className="mr-m-cta">${f.cta}</span>` : null}`}
    </div>
    <ul className="mr-subs">${vs.slice(0, 4).map(function (x) {
      return html`<li key=${x.id} className=${x.status === 'live' ? 'is-live' : ''}><b>${x.name}</b><em>${x.channel === 'sms' ? 'SMS' : x.channel}</em><span>${trunc(vtext(x), 46)}</span></li>`;
    })}</ul>`;
  }
  function journeyOrder(steps) {
    var byId = {}, out = [], seen = {}, q;
    steps.forEach(function (s) { byId[s.id] = s; });
    q = steps.filter(function (s) { return s.type === 'entry'; }).map(function (s) { return s.id; });
    while (q.length && out.length < 14) {
      var id = q.shift(), s = byId[id];
      if (!s || seen[id]) continue;
      seen[id] = 1; out.push(s);
      [s.next, s.yes, s.no].forEach(function (n) { if (n && !seen[n]) q.push(n); });
    }
    return out;
  }
  function JourneyPanel(p) {
    var c = p.camp, steps = journeyOrder(c.journey && c.journey.steps || EMPTY);
    return html`<ol className="mr-jr">${steps.map(function (s) {
      var sub = s.type === 'send' ? (MC.CH && MC.CH.LABEL ? MC.CH.LABEL[s.channel] || s.channel : s.channel) : s.type === 'wait' ? Math.round(s.waitH / 24 * 10) / 10 + ' days' : s.type === 'decide' ? 'Branches yes or no' : '';
      return html`<li key=${s.id}><b>${s.label}</b>${sub ? html`<span>${sub}</span>` : null}</li>`;
    })}</ol>`;
  }
  function BudgetPanel(p) {
    var c = p.camp, st = p.stats, chans = c.channels.filter(function (ch) { return (c.budget.byChannel[ch] || 0) > 0; });
    var total = c.budget.total, cols = ['var(--mc-moss)', 'var(--mc-lake)', 'var(--mc-signal)', 'var(--mc-ink)', 'var(--mc-ghost)'];
    return html`<div className="mr-bud-t"><b>${money(total)}</b><span>${num(Object.keys(c.budget.byChannel).length)} channels</span></div>
      <div className="mr-bbar" aria-hidden="true">${chans.map(function (ch, i) { return html`<i key=${ch} style=${{ width: (total > 0 ? (c.budget.byChannel[ch] / total) * 100 : 0) + '%', background: cols[i % cols.length] }}></i>`; })}</div>
      <ul className="mr-bl">${chans.map(function (ch, i) {
        var spent = st && st.spentByCh ? st.spentByCh[ch] : 0;
        return html`<li key=${ch}><i style=${{ background: cols[i % cols.length] }}></i>${(MC.CH && MC.CH.LABEL && MC.CH.LABEL[ch]) || ch}<span>${money(c.budget.byChannel[ch])}${spent > 0 ? html`<small> ${DOT} ${money(spent)} spent</small>` : null}</span></li>`;
      })}</ul>`;
  }
  function Artifacts(p) {
    var w = p.world, m = p.m, camp = p.camp, seg = p.seg, work = workingSteps(m);
    function busy(kinds) { return work.some(function (s) { return kinds.indexOf(s.kind) >= 0; }); }
    var vs = camp ? MC.catalog.variantsOf(w, camp.id) : EMPTY;
    var st = null;
    if (camp) { try { st = MC.select.campaignStats(w, camp.id); } catch (e) { st = null; } }
    var brand = w.meta && w.meta.tenant ? w.meta.tenant : 'Fernway Outfitters';
    return html`<div className="mr-arts">
      <${Panel} title="Segment" agent="scout" ready=${!!seg} working=${busy(['audience', 'widen'])} flash=${p.flash.seg}>${seg ? html`<${SegmentPanel} seg=${seg} m=${m} />` : null}<//>
      <${Panel} title="Email" agent="copy" ready=${vs.length > 0} working=${busy(['copy', 'rewrite'])} flash=${p.flash.mail}>${vs.length ? html`<${EmailPanel} variants=${vs} brand=${brand} />` : null}<//>
      <${Panel} title="Journey" agent="planner" ready=${!!camp} working=${busy(['campaign', 'extend', 'offer', 'channel'])} flash=${p.flash.jour}>${camp ? html`<${JourneyPanel} camp=${camp} />` : null}<//>
      <${Panel} title="Budget" agent="pacer" ready=${!!camp && camp.budget.total > 0} working=${busy(['pacer', 'budget'])} flash=${p.flash.bud}>${camp ? html`<${BudgetPanel} camp=${camp} stats=${st} />` : null}<//>
    </div>`;
  }

  function Narration(p) {
    var log = (p.m.log || EMPTY).slice(-5), last = log[log.length - 1], tick = p.tick, T = MC.time;
    return html`<div className="mr-narr">
      <h2 className="mr-h">What the team is saying</h2>
      <ol>${log.map(function (b, i) {
        var newest = i === log.length - 1;
        return html`<li key=${b.tick + ':' + b.agentId + ':' + b.text.slice(0, 24)} className=${cx(newest && 'is-new', 'k-' + b.kind)}>
          <b><${Mark} id=${b.agentId} size=${13} />${agentName(b.agentId)}<span>${DOT} ${T && T.relative ? T.relative(b.tick, tick) : ''}</span></b>
          <span className="mr-narr-t">${b.text}</span></li>`;
      })}</ol>
      <div className="mr-sr" role="status" aria-live="polite">${last ? agentName(last.agentId) + ': ' + last.text : ''}</div>
    </div>`;
  }

  function Counters(p) {
    var t = p.tot, camp = p.camp, live = t.sent > 0, chs = camp ? camp.channels.length : 0;
    return html`<div className=${cx('mr-ctrs', live && 'is-live')} role="group" aria-label="Live results">
      <div className="mr-ctr"><span className="k">Reached</span><${Live} value=${Math.round(t.deliv)} text=${num(t.deliv)} /><small>${live ? 'delivered so far' : 'not sent yet'}</small></div>
      <div className="mr-ctr"><span className="k">Sent</span><${Live} value=${Math.round(t.sent)} text=${num(t.sent)} /><small>${chs ? 'across ' + chs + (chs === 1 ? ' channel' : ' channels') : 'no campaign yet'}</small></div>
      <div className="mr-ctr is-rev"><span className="k">Revenue</span><${Live} value=${Math.round(t.rev)} text=${money(t.rev)} /><small>${t.cost > 0 ? 'against ' + money(t.cost) + ' spent' : 'nothing spent yet'}</small></div>
    </div>`;
  }

  /* ---- Lead conversation ---- */
  function threadOf(m) {
    var items = [{ k: 'g', who: 'you', text: m.goalText, tick: m.createdTick, o: 0 }], n = 1;
    (m.steers || EMPTY).forEach(function (s) { items.push({ k: 's' + n, who: 'you', text: s.text, tick: s.tick, o: n++ }); });
    (m.log || EMPTY).forEach(function (b) { if (b.agentId === 'lead') items.push({ k: 'l' + b.tick + ':' + b.text.slice(0, 20), who: 'lead', text: b.text, tick: b.tick, o: n++ }); });
    items.sort(function (a, b) { return a.tick - b.tick || a.o - b.o; });
    return items.slice(-30);
  }
  function LeadColumn(p) {
    var React = R(), m = p.m, st = React.useState(''), text = st[0], setText = st[1];
    var thread = m && p.mode === 'steer' ? threadOf(m) : EMPTY, asks = m ? openAsks(m) : EMPTY;
    var endRef = React.useRef(null), taRef = React.useRef(null);
    React.useEffect(function () { var e = endRef.current; if (e && e.parentNode) e.parentNode.scrollTop = e.parentNode.scrollHeight; }, [thread.length, asks.length, p.creating]);
    React.useEffect(function () { if (p.focusTick && taRef.current) taRef.current.focus(); }, [p.focusTick]);
    function send() {
      var t = text.trim();
      if (!t || p.creating) return;
      p.onSend(t, function (ok) { if (ok) setText(''); });
    }
    var steerMode = p.mode === 'steer' && m;
    var chips = steerMode ? ['Keep the discount under 10%', 'Skip SMS', 'Pause until Monday'] : ['Win back 300 lapsed customers by Dec 20', 'Hit $15k from a weekend flash sale'];
    return html`<aside className=${cx('mr-lead', p.open ? 'is-open' : 'is-shut')} aria-label="Conversation with Lead" data-tour="lead">
      <div className="mr-lead-head">
        <span className="mr-lead-id"><${Mark} id="lead" size=${14} badge=${true} /><b>Lead</b></span>
        <button type="button" className="mr-lead-toggle" aria-expanded=${p.open ? 'true' : 'false'} aria-controls="mr-lead-body" onClick=${p.onToggle}>${p.open ? 'Hide' : 'Talk to Lead'}</button>
      </div>
      <div id="mr-lead-body" className="mr-lead-body" hidden=${!p.open}>
        <div className="mr-thread">
          ${steerMode ? null : html`<p className="mr-msg lead"><span className="who">Lead</span>What should the team get done? Give me an outcome, a deadline and any limits, in a sentence.</p>`}
          ${thread.map(function (x) {
            return x.who === 'you' ? html`<p key=${x.k} className="mr-msg you">${x.text}</p>`
              : html`<p key=${x.k} className="mr-msg lead"><span className="who">Lead</span>${x.text}</p>`;
          })}
          ${asks.map(function (a) {
            return html`<div key=${a.id} className="mr-msg ask"><span className="who">${agentName(a.agentId)} asks</span>${a.question}
              <span className="mr-msg-opts">${a.options.map(function (o) { return html`<button key=${o} type="button" disabled=${p.busy} onClick=${function () { p.onAnswer(a, o); }}>${o}</button>`; })}</span></div>`;
          })}
          ${p.creating ? html`<p className="mr-msg lead is-typing" role="status"><span className="who">Lead</span>Reading your goal and drafting a plan…</p>` : null}
          <span ref=${endRef}></span>
        </div>
        ${p.error ? html`<p className="mr-lead-err" role="alert">${p.error}</p>` : null}
        <div className="mr-chips">${chips.map(function (c) { return html`<button key=${c} type="button" onClick=${function () { setText(c); if (taRef.current) taRef.current.focus(); }}>${c}</button>`; })}</div>
        <div className="mr-compose">
          <div className="mr-mode" role="group" aria-label="What this message does">
            ${m ? html`<button type="button" aria-pressed=${steerMode ? 'true' : 'false'} onClick=${function () { p.onMode('steer'); }}>Steer this mission</button>` : null}
            <button type="button" aria-pressed=${steerMode ? 'false' : 'true'} onClick=${function () { p.onMode('new'); }}>New goal</button>
          </div>
          <label className="mr-sr" htmlFor="mr-lead-input">${steerMode ? 'Steer this mission in plain language' : 'Describe a new goal'}</label>
          <textarea id="mr-lead-input" ref=${taRef} rows="3" value=${text} placeholder=${steerMode ? 'Keep the discount under 10%, skip SMS…' : 'Win back 300 lapsed customers by Dec 20 without discounting more than 15%…'}
            onChange=${function (e) { setText(e.target.value); }}
            onKeyDown=${function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
          <button type="button" className="mr-send" disabled=${!text.trim() || p.creating} onClick=${send}>${steerMode ? 'Steer' : 'Start mission'}</button>
        </div>
      </div>
    </aside>`;
  }

  /* ======================= the view ======================= */
  function MissionRoom(props) {
    var React = R(), useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo;
    useStoreTick();
    var focusId = MC.hooks.useUi ? MC.hooks.useUi(function (u) { return u.missionFocus || null; }) : null;
    var w = getWorld();
    var missions = w && w.missions ? MC.missions.list(w) : EMPTY;
    var st = useState(function () { return (props && (props.id || props.missionId)) || focusId || hashId(); }), wantId = st[0], setWantId = st[1];
    var os = useState(false), newMode = os[0], setNewMode = os[1];
    var ls = useState(function () { return window.innerWidth >= 1100; }), leadOpen = ls[0], setLeadOpen = ls[1];
    var cs = useState(false), creating = cs[0], setCreating = cs[1];
    var es = useState(null), error = es[0], setError = es[1];
    var fs = useState(0), focusTick = fs[0], setFocusTick = fs[1];
    var as = useState(false), busy = as[0], setBusy = as[1];

    useEffect(function () {
      function on() { var h = hashId(); if (h) { setWantId(h); setNewMode(false); } else if (/^#?\/?missions\/new/.test(window.location.hash || '')) { setNewMode(true); setLeadOpen(true); setFocusTick(function (t) { return t + 1; }); } }
      window.addEventListener('hashchange', on);
      on();
      MC.missionRoom = { newGoal: function () { setNewMode(true); setLeadOpen(true); setFocusTick(function (t) { return t + 1; }); }, focus: function (id) { setWantId(id); setNewMode(false); } };
      return function () { window.removeEventListener('hashchange', on); if (MC.missionRoom) delete MC.missionRoom; };
    }, []);
    useEffect(function () { if (focusId) { setWantId(focusId); setNewMode(false); } }, [focusId]);
    useEffect(function () { if (props && (props.id || props.missionId)) setWantId(props.id || props.missionId); }, [props && props.id, props && props.missionId]);

    var m = useMemo(function () {
      if (!missions.length) return null;
      var f = wantId && missions.filter(function (x) { return x.id === wantId; })[0];
      if (f) return f;
      return missions.filter(function (x) { return x.status !== 'done' && x.status !== 'stopped'; })[0] || missions[0];
    }, [missions, wantId]);
    var mid = m ? m.id : null;
    useEffect(function () {
      if (!mid) return;
      try { var want = '#missions/' + mid; if (window.location.hash !== want && /^#?\/?missions/.test(window.location.hash || '#missions')) window.history.replaceState(null, '', want); } catch (e) { /* ignore */ }
    }, [mid]);

    var lay = useMemo(function () { return m ? layout(m) : null; }, [m]);
    var sig = {};
    if (m) {
      (m.plan || EMPTY).forEach(function (s) { sig[s.id] = s.status + ':' + (s.artifact ? s.artifact.id : ''); });
      sig.seg = (m.artifacts || EMPTY).filter(function (a) { return a.kind === 'segment'; }).length;
      var camp0 = w ? campaignOf(w, m) : null;
      sig.mail = camp0 ? MC.catalog.variantsOf(w, camp0.id).length : 0;
      sig.jour = camp0 ? camp0.ver : 0; sig.bud = camp0 ? JSON.stringify(camp0.budget) : 0;
    }
    var flash = useFlash(mid || 'none', sig);

    function pick(id) { setWantId(id); setNewMode(false); setError(null); try { MC.uiStore.set({ missionFocus: id }); } catch (e) { /* ignore */ } }
    function openNew() { setNewMode(true); setLeadOpen(true); setError(null); setFocusTick(function (t) { return t + 1; }); }
    function answer(ask, option) {
      if (!m) return;
      setBusy(true);
      var r = MC.missions.answer(m.id, ask.id, option);
      setBusy(false);
      setError(r && r.ok ? null : (r && r.error) || 'That didn’t go through.');
    }
    function send(textIn, done) {
      setError(null);
      if (newMode || !m) {
        setCreating(true);
        MC.missions.create(textIn).then(function (r) {
          setCreating(false);
          if (r && r.ok) { setWantId(r.id); setNewMode(false); done(true); } else { setError((r && r.error) || 'I couldn’t start that.'); done(false); }
        }, function () { setCreating(false); setError('I couldn’t start that.'); done(false); });
        return;
      }
      var r = MC.missions.steer(m.id, textIn);
      if (r && r.ok) done(true); else { setError((r && r.error) || 'That didn’t go through.'); done(false); }
    }

    if (!w) return html`<section className="v-missions"><h1 className="mr-goal-h">Loading the mission room</h1></section>`;
    var leadProps = { m: m, mode: newMode || !m ? 'new' : 'steer', open: leadOpen, onToggle: function () { setLeadOpen(!leadOpen); }, onSend: send, onAnswer: answer,
      onMode: function (md) { setNewMode(md === 'new'); }, creating: creating, error: error, busy: busy, focusTick: focusTick };

    if (!m) {
      return html`<section className="v-missions is-empty"><div className="mr-main">
        <div className="mr-center"><h1 className="mr-goal-h" id="page-title" tabIndex="-1" data-tour="goal">What should the team get done?</h1>
          <p className="mr-status">Say the outcome, the deadline and any limits. Lead will plan it and the agents will start working in front of you.</p></div>
        <${LeadColumn} ...${leadProps} open=${true} /></div></section>`;
    }

    var tick = w.meta.tick, camp = campaignOf(w, m), seg = segmentOf(w, m), cids = campaignIds(w, m), tot = totalsOf(w, cids), pr = progressOf(w, m);
    var asks = openAsks(m), ask = asks[0], sentence = statusSentence(w, m, tot, seg, camp);
    var anyWork = workingSteps(m).length > 0;
    return html`<section className=${cx('v-missions', leadOpen && 'lead-open')} aria-label="Mission room">
      <${Switcher} world=${w} missions=${missions} currentId=${m.id} onPick=${pick} onNew=${openNew} />
      <div className="mr-main">
        <div className="mr-center">
          <header className="mr-goal">
            <h1 className="mr-goal-h" id="page-title" tabIndex="-1" data-tour="goal">${m.goalText}</h1>
            <${Meta} world=${w} m=${m} progress=${pr} />
          </header>
          <p className="mr-status">${sentence.map(function (x, i) { return typeof x === 'string' ? x : html`<${Live} key=${i} value=${x.b} text=${x.b} />`; })}</p>
          <div className=${cx('mr-board', ask && ask.blocking !== false && 'is-held')}>
            ${ask ? html`<${AskCard} ask=${ask} m=${m} count=${asks.length} busy=${busy} error=${error} onAnswer=${answer} />` : null}
            <div className="mr-board-lanes" inert=${ask && ask.blocking !== false ? '' : undefined}>
              <${Board} m=${m} world=${w} lay=${lay} flash=${flash} />
            </div>
            <p className="mr-board-foot">${m.status === 'paused' ? 'Paused. Tell Lead when to pick it back up.' : m.status === 'done' ? 'This mission has finished.' : m.status === 'stopped' ? 'This mission was stopped.' : ask ? 'Waiting on your decision. Steps that don’t depend on it keep going.' : anyWork ? 'The team is working. This board updates as they finish.' : m.phase === 'monitoring' ? 'The plan is in place. Insight Analyst checks results every morning.' : 'Next steps start as soon as their inputs are ready.'}</p>
          </div>
          <div className="mr-bay">
            <${Narration} m=${m} tick=${tick} />
            <${Counters} tot=${tot} camp=${camp} />
            <${Artifacts} world=${w} m=${m} camp=${camp} seg=${seg} flash=${flash} />
          </div>
        </div>
        <${LeadColumn} ...${leadProps} />
      </div>
    </section>`;
  }

  MC.views.missions = MissionRoom;
})();
