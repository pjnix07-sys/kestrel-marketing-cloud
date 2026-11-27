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
  var ROW_H = 78, BLOCK_H = 54, CAP_H = 20, MIN_COL = 156;

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
  function ago(tick, now) {
    var T = MC.time, d, dd;
    if (!T || !T.dayOf || !fin(tick) || !fin(now)) return '';
    dd = T.dayOf(now) - T.dayOf(tick);
    if (dd >= 7) return dd < 14 ? '1 week ago' : Math.floor(dd / 7) + ' weeks ago';
    return T.relative ? T.relative(tick, now) : '';
  }
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
  // One definition per quantity (docs/CONSISTENCY.md section 1): the mission's numbers come from MC.metrics.mission.
  function metricsOf(w, m) {
    try { if (MC.metrics && typeof MC.metrics.mission === 'function') return MC.metrics.mission(w, m.id) || null; } catch (e) { /* use fallback */ }
    return null;
  }
  function pick(o, keys) { for (var i = 0; i < keys.length; i++) if (o && fin(o[keys[i]])) return o[keys[i]]; return null; }
  function totalsFromMetrics(r) {
    if (!r) return null;
    var sent = pick(r, ['sent', 'sends']), rev = pick(r, ['revenue', 'rev']);
    if (sent === null && rev === null) return null;
    return { sent: sent || 0, deliv: pick(r, ['delivered', 'deliv']) || 0, reached: pick(r, ['reached', 'people']), rev: rev || 0, cost: pick(r, ['cost', 'spend', 'spent']) || 0, conv: pick(r, ['orders', 'conv']) || 0 };
  }
  function openAsks(m) { return (m.asks || EMPTY).filter(function (a) { return a.status === 'open'; }); }
  function progressOf(w, m) {
    var r = metricsOf(w, m);
    if (r && fin(r.forecast) && fin(r.value)) {
      var base = null;
      try { base = MC.missions.progressOf(w, m, w.meta.tick); } catch (e) { base = null; }
      return Object.assign({}, base || {}, { value: r.value, target: fin(r.target) ? r.target : m.objective.target, forecast: r.forecast, lo: fin(r.lo) ? r.lo : r.forecast, hi: fin(r.hi) ? r.hi : r.forecast, band: r.band || (base && base.band) || 'early' });
    }
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
    if (s.kind === 'copy' && m.data && m.data.content && m.data.content.summary) return { short: m.data.content.summary, full: m.data.content.summary + (c ? ' for ' + c.name : '') };
    if (c && (s.kind === 'copy' || s.kind === 'rewrite')) {
      vs = MC.catalog.variantsOf(w, c.id);
      var mids = {}, chs = {};
      vs.forEach(function (v) { if (v.messageId) { mids[v.messageId] = 1; chs[v.channel] = 1; } });
      var nm = Object.keys(mids).length, nc = Object.keys(chs).length;
      if (nm) return { short: nm + (nm === 1 ? ' message' : ' messages') + ' \u00b7 ' + nc + (nc === 1 ? ' channel' : ' channels'), full: nm + (nm === 1 ? ' message' : ' messages') + ' \u00b7 ' + nc + (nc === 1 ? ' channel' : ' channels') + ' for ' + c.name };
    }
    if (c && s.kind === 'copy') { vs = MC.catalog.variantsOf(w, c.id); return { short: vs.length + (vs.length === 1 ? ' message' : ' messages'), full: vs.length + ' messages written for ' + c.name }; }
    if (c && (s.kind === 'pacer' || s.kind === 'budget')) return { short: money(c.budget.total) + ' split', full: money(c.budget.total) + ' split across ' + c.channels.length + ' channels' };
    if (s.kind === 'sendtime') return { short: 'Send windows', full: s.note || 'Send windows set' };
    if (s.kind === 'guard') return { short: 'Rested list', full: s.note || 'Over-messaged people rested' };
    if (s.kind === 'goal') return { short: 'Goal and limits', full: s.note || 'Goal confirmed' };
    if (s.kind === 'handoff') return { short: 'For sign-off', full: s.note || 'Ready for your sign-off' };
    return { short: trunc(s.note || s.title, 18), full: s.note || s.title };
  }

  /* ---- forecast verdict beside the goal: "On pace for 312 of 400 (260 to 365) by Dec 15" ---- */
  function fm(m, v) { return L().fmtMetric ? L().fmtMetric(m.objective.metric, v) : num(v); }
  function verdictOf(w, m, pr) {
    var o = m.objective, tone = pr.band || 'early', by = dayShort(o.by);
    if (m.status === 'done') return { tone: 'on', text: 'Finished at ' + fm(m, pr.value) + ' of ' + fm(m, o.target) };
    if (m.status === 'stopped') return null;
    if (!pr.hasCampaign && !fin(pr.forecast)) return { tone: 'early', text: 'No forecast yet. It appears once a campaign is planned.' };
    var range = fin(pr.lo) && fin(pr.hi) && pr.hi > pr.lo ? ' (' + fm(m, pr.lo) + ' to ' + fm(m, pr.hi) + ')' : '';
    var atMost = o.direction === 'atMost', of = ' of ' + fm(m, o.target);
    if (tone === 'early') return { tone: 'early', text: 'Too early to call: plan expects ' + fm(m, pr.forecast) + of + range + ' by ' + by };
    if (atMost) return { tone: tone, text: (tone === 'behind' ? 'Over the limit: heading for ' : 'On pace to stay under ' + fm(m, o.target) + ', ending near ') + fm(m, pr.forecast) + range + ' by ' + by };
    return { tone: tone, text: (tone === 'ahead' ? 'Ahead of pace for ' : tone === 'behind' ? 'Behind pace: ' : 'On pace for ') + fm(m, pr.forecast) + of + range + ' by ' + by };
  }
  function Verdict(p) {
    var v = verdictOf(p.world, p.m, p.progress);
    if (!v) return null;
    return html`<p className=${cx('mr-verdict', 'is-' + v.tone)} data-verdict=${v.tone}><span className="mr-verdict-k">Forecast</span><b>${v.text}</b></p>`;
  }

  /* ---- what an agent weighed: step.decision = {options:[{label, value, note}], chose, why} ---- */
  function optValue(v) { return fin(v) ? (Math.abs(v) < 1 && v !== 0 ? (Math.round(v * 1000) / 10) + '%' : num(v)) : (v === undefined || v === null ? '' : String(v)); }
  function isChosen(d, o) { return d.chose === o.label || d.chose === o.id || (d.chose && o.label && String(d.chose).toLowerCase() === String(o.label).toLowerCase()); }
  function decisionLine(d) {
    var opts = (d.options || EMPTY).map(function (o) { return o.label + (o.value !== undefined && o.value !== null && o.value !== '' ? ' (' + optValue(o.value) + ')' : ''); });
    return (opts.length ? 'Weighed ' + opts.join(', ') + '. ' : '') + (d.chose ? 'Chose ' + d.chose + (d.why ? ': ' + d.why : '.') : (d.why || ''));
  }
  function Decision(p) {
    var d = p.d;
    if (!d || !(d.options || EMPTY).length) return d && d.why ? html`<p className="mr-why-t">${d.why}</p>` : null;
    return html`<div className=${cx('mr-dec', p.compact && 'is-compact')}>
      <ul className="mr-opts" aria-label="Options considered">${d.options.map(function (o, i) {
        var on = isChosen(d, o);
        return html`<li key=${i} className=${cx('mr-opt', on && 'is-chosen')}>
          <span className="mr-opt-l">${o.label}${on ? html`<em className="mr-opt-flag"> chosen</em>` : null}</span>
          ${o.value !== undefined && o.value !== null && o.value !== '' ? html`<span className="mr-opt-v num">${optValue(o.value)}</span>` : null}
          ${o.note ? html`<span className="mr-opt-n">${o.note}</span>` : null}</li>`;
      })}</ul>
      ${d.why ? html`<p className="mr-why-t"><b>Why:</b> ${d.why}</p>` : null}
    </div>`;
  }
  function StepWhy(p) {
    var s = p.step;
    if (!s) return null;
    return html`<section className="mr-why" aria-label=${'What ' + agentName(s.agentId) + ' weighed'} data-tour="why">
      <h2 className="mr-h"><${Mark} id=${s.agentId} size=${13} /> What ${agentName(s.agentId)} weighed <span className="mr-why-step">${DOT} ${s.title}</span></h2>
      <${Decision} d=${s.decision} />
    </section>`;
  }

  /* ---- beats that carry structure: steering diffs and two agents disagreeing ---- */
  function diffOf(b) { return Array.isArray(b.diff) ? b.diff.filter(function (x) { return x && (x.what || x.from || x.to); }) : EMPTY; }
  function DiffList(p) {
    var d = p.diff;
    if (!d.length) return null;
    return html`<div className="mr-diff"><p className="mr-diff-h">What changed</p>
      <ul>${d.map(function (x, i) {
        return html`<li key=${i}><span className="mr-diff-w">${x.what}</span>${x.from !== undefined && x.from !== null && x.from !== '' ? html`<s className="mr-diff-f">${String(x.from)}</s>` : null}
          ${x.to !== undefined && x.to !== null && x.to !== '' ? html`<span className="mr-diff-t" aria-label=${'now ' + x.to}><span aria-hidden="true">now </span>${String(x.to)}</span>` : html`<span className="mr-diff-t">removed</span>`}</li>`;
      })}</ul></div>`;
  }
  function sidesOf(b) {
    var raw = b.positions || b.sides || b.agents || b.views || (b.a && b.b ? [b.a, b.b] : null) || EMPTY;
    return raw.map(function (x) { return { agentId: x.agentId || x.agent || x.id, text: x.text || x.position || x.says || x.stance || x.say || '' }; }).filter(function (x) { return x.agentId; });
  }
  function Disagree(p) {
    var b = p.b, sides = sidesOf(b), res = b.resolution || b.resolved || b.outcome || '';
    if (!sides.length) return null;
    return html`<div className="mr-dis" role="group" aria-label="Two agents disagreed">
      <p className="mr-diff-h">They disagreed</p>
      <div className="mr-dis-sides">${sides.slice(0, 2).map(function (x, i) {
        return html`<div key=${i} className="mr-dis-side"><p className="mr-dis-who"><${Mark} id=${x.agentId} size=${13} />${agentName(x.agentId)}</p><p>${x.text}</p></div>`;
      })}</div>
      ${res ? html`<p className="mr-dis-res"><b>Resolved:</b> ${typeof res === 'string' ? res : (res.text || res.summary || '')}</p>` : null}
    </div>`;
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

  // Campaign, audience and message this mission made, each a link into its own screen.
  function MissionLinks(p) {
    var w = p.world, m = p.m, X = MC.xref, Lk = MC.ui && MC.ui.Xlink;
    if (!X || !Lk) return null;
    var cids = X.campaignIds(w, m), sids = X.segmentIds(w, m), mids = [];
    cids.forEach(function (cid) { X.messagesOfCampaign(w, cid).forEach(function (x) { if (!mids.some(function (y) { return y.id === x.id; })) mids.push(x); }); });
    var parts = [];
    function add(lab, kind, items, nameOf) {
      if (!items.length) return;
      parts.push(html`<span key=${lab} className="mr-links-p"><span className="mr-links-k">${lab}</span> ${items.slice(0, 3).map(function (x, i) { return html`<span key=${kind + (x.id || x)}>${i ? ', ' : ''}<${Lk} kind=${kind} id=${x.id || x}>${nameOf(x)}<//></span>`; })}</span>`);
    }
    add(cids.length === 1 ? 'Campaign' : 'Campaigns', 'campaign', cids, function (id) { return w.campaigns.byId[id].name; });
    add(sids.length === 1 ? 'Audience' : 'Audiences', 'segment', sids, function (id) { return w.segments.byId[id].name; });
    add(mids.length === 1 ? 'Message' : 'Messages', 'message', mids, function (x) { return trunc(x.name, 44); });
    if (!parts.length) return null;
    return html`<p className="mr-links" aria-label="What this mission made">${parts}</p>`;
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
    var dec = s.decision && (s.decision.options || s.decision.why) ? s.decision : null;
    function pickMe(e) { if (p.onSelect) p.onSelect(s.id); }
    return html`<div className=${cx('mr-blk', 's-' + st, p.flash && 'is-flash', dec && 'has-why', p.selected && 'is-picked')} role="listitem" title=${dec ? decisionLine(dec) : (s.note || s.title)}
        aria-label=${agentName(s.agentId) + ': ' + s.title + ', ' + label + (dec ? '. Weighed ' + (dec.options || EMPTY).length + ' options' + (dec.chose ? ', chose ' + dec.chose : '') : '')}
        tabIndex="0" aria-current=${p.selected ? 'true' : undefined} data-step=${s.id} onClick=${pickMe} onFocus=${pickMe}
        onKeyDown=${function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickMe(e); } }}
        style=${{ left: pos.x + 'px', top: pos.y + 'px', width: pos.w + 'px', height: BLOCK_H + 'px' }}>
      <span className="mr-blk-t">${s.title}</span>
      ${dec && dec.chose ? html`<span className="mr-blk-c">${trunc(dec.chose, 28)}</span>` : null}
      <span className="mr-sr">${label}</span>
      ${st === 'working' ? html`<i className="mr-blk-fill" style=${{ width: (frac * 100).toFixed(0) + '%' }}></i>` : null}
    </div>`;
  }

  function stepLine(m, aid) {
    var mine = (m.plan || EMPTY).filter(function (s) { return s.agentId === aid; });
    var cur = mine.filter(function (s) { return s.status === 'working'; })[0], bl = mine.filter(function (s) { return s.status === 'blocked'; })[0];
    var q = mine.filter(function (s) { return s.status === 'queued'; })[0];
    var allDone = mine.every(function (s) { return s.status === 'done' || s.status === 'skipped'; });
    var last = mine.filter(function (s) { return s.status === 'done'; }).pop();
    if (cur) return { state: 'work', word: 'Working', title: cur.title };
    if (bl) return { state: 'wait', word: 'Waiting on you', title: bl.title };
    if (allDone) return { state: 'ok', word: 'Done', title: m.phase === 'monitoring' && aid === 'analyst' ? 'Tracking results daily' : last ? last.title : 'Nothing left to do' };
    return { state: 'idle', word: 'Up next', title: q ? q.title : 'Idle' };
  }
  function AgentRows(p) {
    var m = p.m;
    return html`<ul className="mr-rows" aria-label="Agents and their current step">${p.lay.rows.map(function (aid) {
      var ln = stepLine(m, aid), mine = (m.plan || EMPTY).filter(function (s) { return s.agentId === aid; });
      var done = mine.filter(function (s) { return s.status === 'done'; }).length;
      return html`<li key=${aid} className=${cx('mr-row', 'is-' + ln.state)}>
        <span className="mr-row-h"><span className="mr-led" aria-hidden="true"></span><span className="mr-nm"><${Mark} id=${aid} size=${14} />${agentName(aid)}</span>
          <span className="mr-row-w">${ln.word}</span></span>
        <span className="mr-row-t">${ln.title}${(function () { var ds = mine.filter(function (x) { return x.decision && x.decision.options; }).pop(); return ds && p.onSelect ? html` <button type="button" className="mr-row-why" onClick=${function () { p.onSelect(ds.id); }}>What it weighed</button>` : null; })()}</span>
        <span className="mr-row-n">${done} of ${mine.length} ${mine.length === 1 ? 'step' : 'steps'} done</span>
      </li>`;
    })}</ul>`;
  }

  function Board(p) {
    var React = R(), m = p.m, w = p.world, lay = p.lay, ref = React.useRef(null);
    var avail = MC.hooks.useWidth(ref);
    var narrow = avail > 0 && avail < 600;
    var colW = Math.max(MIN_COL, lay.ncols ? avail / lay.ncols : MIN_COL);
    var gap = clamp(colW * 0.12, 18, 30), blockW = colW - gap, stageW = colW * lay.ncols;
    var H = lay.rows.length * ROW_H, tick = w.meta.tick;
    function pos(s) { var c = lay.cells[s.id]; return { x: c.col * colW, y: c.row * ROW_H + CAP_H, w: blockW }; }
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
        var passed = src.status === 'done' && !active;
        wires.push({ k: nid + '>' + s.id, d: d, active: active, passed: passed });
        if (src.status === 'done' && !seenChip[nid]) { seenChip[nid] = 1; chips.push({ k: nid, x: a.x + a.w, y: lay.cells[nid].row * ROW_H + 2, active: active, p: payloadOf(w, m, src), from: src.agentId, to: s.agentId }); }
        else if (active && seenChip[nid]) chips.forEach(function (c) { if (c.k === nid) c.active = true; });
      });
    });
    return html`<div className="mr-scroll" data-tour="lanes" ref=${ref} role="region" aria-label="Agent team board" tabIndex="0">
      ${narrow ? html`<${AgentRows} m=${m} lay=${lay} onSelect=${p.onSelect} />` : html`<div className="mr-lanes" style=${{ width: stageW + 'px', minWidth: '100%' }}>
        ${lay.rows.map(function (aid, ri) {
          var ln = stepLine(m, aid);
          return html`<div key=${aid} className=${cx('mr-lane', 'is-' + ln.state)} style=${{ height: ROW_H + 'px' }}>
            <span className="mr-cap"><span className="mr-led" aria-hidden="true"></span><span className="mr-nm"><${Mark} id=${aid} size=${14} />${agentName(aid)}</span></span>
          </div>`;
        })}
        <svg className="mr-wires" aria-hidden="true" width=${stageW} height=${H}>
          ${wires.map(function (x) { return html`<path key=${x.k} d=${x.d} className=${cx(x.active && 'is-active', x.passed && 'is-passed')} />`; })}
        </svg>
        <div className="mr-stage" role="list" aria-label="Steps" style=${{ left: 0, width: stageW + 'px', height: H + 'px' }}>
          ${(m.plan || EMPTY).map(function (s) { return lay.cells[s.id] ? html`<${Block} key=${s.id} step=${s} pos=${pos(s)} tick=${tick} flash=${p.flash[s.id]} selected=${p.selId === s.id} onSelect=${p.onSelect} />` : null; })}
          ${chips.map(function (c) {
            return html`<span key=${'c' + c.k} className=${cx('mr-baton', c.active && 'is-active')} style=${{ left: (c.x + 3) + 'px', top: c.y + 'px', maxWidth: Math.max(colW + gap, 150) + 'px' }}
              title=${agentName(c.from) + ' handed ' + c.p.full + ' to ' + agentName(c.to)}>${c.p.short}</span>`;
          })}
        </div>
      </div>`}
    </div>`;
  }

  function AskCard(p) {
    var ask = p.ask, m = p.m, im = ask.impact || {}, metric = im.metric || '';
    var hasImpact = fin(im.lo) && fin(im.hi) && (im.lo || im.hi);
    var held = (m.plan || EMPTY).filter(function (s) { return s.status === 'blocked'; }).length;
    var more = p.count > 1 ? ' (' + (p.count - 1) + ' more after this)' : '';
    return html`<section className="mr-ask" data-tour="ask" aria-labelledby="mr-ask-q">
      <div className="mr-ask-main">
        <p className="mr-ask-who"><${Mark} id=${ask.agentId} size=${13} /> ${agentName(ask.agentId)} needs a decision${more}${ask.blocking !== false && held ? ' · ' + held + (held === 1 ? ' step is' : ' steps are') + ' waiting' : ''}</p>
        <h2 id="mr-ask-q">${ask.question}</h2>
        <details className="mr-ask-why"><summary>Why ${agentName(ask.agentId)} is asking</summary><p>${ask.why}</p></details>
      </div>
      <div className="mr-ask-side">
        ${hasImpact ? html`<p className="mr-ask-imp"><span className="k">If you agree</span><b>${num(im.lo)} to ${num(im.hi)}</b> <small>${metric || 'expected change'}</small></p>` : null}
        <div className="mr-ask-act">
          ${ask.options.map(function (o) {
            return html`<button key=${o} type="button" className=${cx('mr-ask-btn', o === ask.default && 'go')} disabled=${p.busy} onClick=${function () { p.onAnswer(ask, o); }}>${o}</button>`;
          })}
        </div>
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
      ${seg && MC.ui.Xlink ? html`<p className="mr-art-note"><${MC.ui.Xlink} kind="segment" id=${seg.id}>Open this audience<//></p>` : null}
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
  function plainTokens(t) { return String(t || '').replace(/\{(\w+)(?:\|([^}]*))?\}/g, function (x, n, fb) { return fb || n.replace(/_/g, ' '); }); }
  // The message a send step delivers: the campaign's live message on that channel and the words its channel version carries.
  function stepMessage(w, c, ch) {
    var K = MC.content, X = MC.xref, out = null;
    if (!K || !X) return null;
    X.messagesOfCampaign(w, c.id).forEach(function (x) { if (!out && x.channels.indexOf(ch) >= 0) out = x; });
    if (!out) return null;
    var r = K.render(w, out.id, ch, {}), f = (r && r.fields) || {};
    var t = ch === 'email' ? (f.headline || f.subject) : ch === 'sms' ? f.sms : ch === 'push' ? ((f.pushTitle || '') + ' ' + (f.pushBody || '')) : (f.socialHeadline || f.socialText);
    return { id: out.id, name: out.name, text: trunc(plainTokens(t), 52) };
  }
  function JourneyPanel(p) {
    var c = p.camp, w = p.world;
    var steps = journeyOrder(c.journey && c.journey.steps || EMPTY).filter(function (s) { return s.type !== 'send' || !s.channel || c.channels.indexOf(s.channel) >= 0; });
    return html`<ol className="mr-jr">${steps.map(function (s) {
      var sub = s.type === 'send' ? (MC.CH && MC.CH.LABEL ? MC.CH.LABEL[s.channel] || s.channel : s.channel) : s.type === 'wait' ? Math.round(s.waitH / 24 * 10) / 10 + ' days' : s.type === 'decide' ? 'Branches yes or no' : '';
      var msg = s.type === 'send' && w ? stepMessage(w, c, s.channel) : null;
      return html`<li key=${s.id}><b>${s.label}</b>${sub ? html`<span>${sub}</span>` : null}
        ${msg ? html`<span className="mr-jr-msg"><${MC.ui.Xlink} kind="message" id=${msg.id}>${msg.name}<//>${msg.text ? html` ${DOT} “${msg.text}”` : null}</span>` : null}</li>`;
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
  var MSG_CH = ['email', 'sms', 'push', 'social', 'web'];
  function MessagePanel(p) {
    var K = MC.content, w = p.world, id = p.messageId, m = K && K.message(w, id);
    if (!m) return null;
    var Scene = MC.ui && MC.ui.Scene, blocks = K.blockIdsOf(m).map(function (b) { return K.block(w, b); }).filter(Boolean);
    return html`<div className="mr-msg-art">
      <p className="mr-msg-name">${m.name}</p>
      <ul className="mr-msg-blocks">${blocks.filter(function (b) { return b.kind !== 'image' && b.kind !== 'product'; }).slice(0, 5).map(function (b) {
        return html`<li key=${b.id}><em>${K.KIND_LABEL[b.kind] || b.kind}</em><span>${trunc(K.textOf(b).replace(/\{(\w+)(?:\|([^}]*))?\}/g, function (x, n, fb) { return fb || n.replace(/_/g, ' '); }), 54)}</span></li>`;
      })}</ul>
      <div className="mr-msg-vers" aria-label="Channel versions">${MSG_CH.map(function (ch) {
        if (p.channels && p.channels.indexOf(ch) < 0) return null;
        var r = K.render(w, id, ch, {}), f = r.fields || {}, t;
        if (r.error) return null;
        t = ch === 'email' ? (f.headline || f.subject) : ch === 'sms' ? f.sms : ch === 'push' ? (f.pushTitle + ' ' + f.pushBody) : f.socialHeadline;
        return html`<div key=${ch} className=${'mr-ver mr-ver-' + ch}><b>${(MC.CH && MC.CH.LABEL && MC.CH.LABEL[ch]) || ch}</b>
          ${Scene && f.imageId && (ch === 'email' || ch === 'web') ? html`<${Scene} imageId=${f.imageId} style=${{ borderRadius: 0, height: 22, width: '100%', objectFit: 'cover' }} />` : null}
          <span>${trunc(String(t || '').replace(/\{(\w+)(?:\|([^}]*))?\}/g, function (x, n, fb) { return fb || n.replace(/_/g, ' '); }), 60)}</span></div>`;
      })}</div>
      <a className="mr-msg-open" href=${'#content'} onClick=${function () { try { MC.uiStore.setFocus('content', { messageId: id, variantId: null, tab: 'compose' }); } catch (e) { /* link still works */ } }}>Open in Content</a>
    </div>`;
  }
  function Artifacts(p) {
    var w = p.world, m = p.m, camp = p.camp, seg = p.seg, work = workingSteps(m);
    function busy(kinds) { return work.some(function (s) { return kinds.indexOf(s.kind) >= 0; }); }
    var vs = camp ? MC.catalog.variantsOf(w, camp.id) : EMPTY;
    var msgId = null;
    vs.forEach(function (v) { if (!msgId && v.messageId && v.status !== 'retired') msgId = v.messageId; });
    var st = null;
    if (camp) { try { st = MC.select.campaignStats(w, camp.id); } catch (e) { st = null; } }
    var brand = w.meta && w.meta.tenant ? w.meta.tenant : 'Fernway Outfitters';
    return html`<div className="mr-arts">
      <${Panel} title="Segment" agent="scout" ready=${!!seg} working=${busy(['audience', 'widen'])} flash=${p.flash.seg}>${seg ? html`<${SegmentPanel} seg=${seg} m=${m} />` : null}<//>
      <${Panel} title=${msgId ? "Message" : "Email"} agent="copy" ready=${vs.length > 0} working=${busy(['copy', 'rewrite'])} flash=${p.flash.mail}>${vs.length ? (msgId && MC.content && MC.content.message ? html`<${MessagePanel} world=${w} messageId=${msgId} channels=${camp ? camp.channels : null} />` : html`<${EmailPanel} variants=${vs} brand=${brand} />`) : null}<//>
      <${Panel} title="Journey" agent="planner" ready=${!!camp} working=${busy(['campaign', 'extend', 'offer', 'channel'])} flash=${p.flash.jour}>${camp ? html`<${JourneyPanel} camp=${camp} world=${w} />` : null}<//>
      <${Panel} title="Budget" agent="pacer" ready=${!!camp && camp.budget.total > 0} working=${busy(['pacer', 'budget'])} flash=${p.flash.bud}>${camp ? html`<${BudgetPanel} camp=${camp} stats=${st} />` : null}<//>
    </div>`;
  }

  function Narration(p) {
    var m = p.m, all = m.log || EMPTY, tick = p.tick, last = all[all.length - 1], byId = {};
    (m.plan || EMPTY).forEach(function (s) { byId[s.id] = s; });
    var log = all.slice(-5);
    // a disagreement or a steering diff stays visible until five newer beats have pushed it out
    var pin = null;
    for (var k = all.length - 1; k >= 0 && k >= all.length - 12; k--) if (all[k].kind === 'disagree' && log.indexOf(all[k]) < 0) { pin = all[k]; break; }
    if (pin) log = [pin].concat(log.slice(1));
    return html`<div className="mr-narr">
      <h2 className="mr-h">What the team is saying</h2>
      <ol>${log.map(function (b, i) {
        var newest = i === log.length - 1, dis = b.kind === 'disagree', diff = diffOf(b);
        var st = b.stepId ? byId[b.stepId] : null, dec = b.decision || (st && st.decision && b.kind !== 'ask' ? st.decision : null);
        return html`<li key=${b.tick + ':' + b.agentId + ':' + b.text.slice(0, 24)} className=${cx(newest && 'is-new', 'k-' + b.kind)}>
          <b><${Mark} id=${b.agentId} size=${13} />${agentName(b.agentId)}<span>${DOT} ${ago(b.tick, tick)}</span></b>
          <span className="mr-narr-t">${b.text}</span>
          ${dis ? html`<${Disagree} b=${b} />` : null}
          ${diff.length ? html`<${DiffList} diff=${diff} />` : null}
          ${dec && dec.options && dec.options.length ? html`<details className="mr-narr-why"><summary>What ${agentName(b.agentId)} weighed</summary><${Decision} d=${dec} compact=${true} /></details>` : null}</li>`;
      })}</ol>
      <div className="mr-sr" role="status" aria-live="polite">${last ? agentName(last.agentId) + ': ' + last.text : ''}</div>
    </div>`;
  }

  function Counters(p) {
    var t = p.tot, camp = p.camp, live = t.sent > 0, chs = camp ? camp.channels.length : 0;
    return html`<div className=${cx('mr-ctrs', live && 'is-live')} role="group" aria-label="Live results">
      <div className="mr-ctr"><span className="k">Reached</span><${Live} value=${Math.round(fin(t.reached) ? t.reached : t.deliv)} text=${num(fin(t.reached) ? t.reached : t.deliv)} /><small>${live ? (fin(t.reached) ? 'people delivered to' : 'delivered so far') : 'not sent yet'}</small></div>
      <div className="mr-ctr"><span className="k">Sent</span><${Live} value=${Math.round(t.sent)} text=${num(t.sent)} /><small>${chs ? 'across ' + chs + (chs === 1 ? ' channel' : ' channels') : 'no campaign yet'}</small></div>
      <div className="mr-ctr is-rev"><span className="k">Revenue</span><${Live} value=${Math.round(t.rev)} text=${money(t.rev)} /><small>${t.cost > 0 ? 'against ' + money(t.cost) + ' spent' : 'nothing spent yet'}</small></div>
    </div>`;
  }

  /* ---- Lead conversation ---- */
  function threadOf(m) {
    var items = [{ k: 'g', who: 'you', text: m.goalText, tick: m.createdTick, o: 0 }], n = 1;
    (m.steers || EMPTY).forEach(function (s) { items.push({ k: 's' + n, who: 'you', text: s.text, tick: s.tick, o: n++ }); });
    (m.log || EMPTY).forEach(function (b) { if (b.agentId === 'lead') items.push({ k: 'l' + b.tick + ':' + b.text.slice(0, 20), who: 'lead', text: b.text, tick: b.tick, o: n++, diff: diffOf(b) }); });
    items.sort(function (a, b) { return a.tick - b.tick || a.o - b.o; });
    return items.slice(-30);
  }
  function LeadColumn(p) {
    var React = R(), m = p.m, st = React.useState(''), text = st[0], setText = st[1];
    var thread = m && p.mode === 'steer' ? threadOf(m) : EMPTY, asks = m ? openAsks(m) : EMPTY;
    var endRef = React.useRef(null), taRef = React.useRef(null);
    var fitRef = React.useRef('');
    // Open on the latest message. When the whole conversation fits in a little more than the default window, grow the
    // window to fit it (once per mission and mode) so the first message and the top padding are never clipped.
    React.useEffect(function () {
      var e = endRef.current, t = e && e.parentNode;
      if (!t) return;
      var key = (m ? m.id : '') + '|' + p.mode;
      if (fitRef.current !== key && t.scrollHeight > 0) {
        fitRef.current = key;
        t.style.maxHeight = '';
        var cap = Math.round(window.innerHeight * 0.7);
        if (t.scrollHeight > t.clientHeight && t.scrollHeight <= cap) t.style.maxHeight = t.scrollHeight + 'px';
      }
      t.scrollTop = t.scrollHeight;
    }, [thread.length, asks.length, p.creating, p.open, m && m.id, p.mode]);
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
              : html`<div key=${x.k} className="mr-msg lead"><span className="who">Lead</span>${x.text}${x.diff && x.diff.length ? html`<${DiffList} diff=${x.diff} />` : null}</div>`;
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
    var ss = useState(null), selStep = ss[0], setSelStep = ss[1];

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

    var tick = w.meta.tick, camp = campaignOf(w, m), seg = segmentOf(w, m), cids = campaignIds(w, m), pr = progressOf(w, m);
    var tot = totalsFromMetrics(metricsOf(w, m)) || { sent: 0, deliv: 0, reached: null, rev: 0, cost: 0, conv: 0 };
    var whyStep = (m.plan || EMPTY).filter(function (x) { return x.id === selStep && x.decision; })[0] || null;
    if (!whyStep) {
      var withDec = (m.plan || EMPTY).filter(function (x) { return x.decision && (x.decision.options || x.decision.why) && x.status !== 'queued'; });
      withDec.sort(function (a, b) { return (b.doneTick || b.startedTick || 0) - (a.doneTick || a.startedTick || 0); });
      whyStep = withDec[0] || null;
    }
    var asks = openAsks(m), ask = asks[0], sentence = statusSentence(w, m, tot, seg, camp);
    var anyWork = workingSteps(m).length > 0;
    return html`<section className=${cx('v-missions', leadOpen && 'lead-open')} aria-label="Mission room">
      <${Switcher} world=${w} missions=${missions} currentId=${m.id} onPick=${pick} onNew=${openNew} />
      <div className="mr-main">
        <div className="mr-center">
          <header className="mr-goal">
            <h1 className="mr-goal-h" id="page-title" tabIndex="-1" data-tour="goal">${m.goalText}</h1>
            <${Verdict} world=${w} m=${m} progress=${pr} />
            <${Meta} world=${w} m=${m} progress=${pr} />
            <${MissionLinks} world=${w} m=${m} />
          </header>
          <p className="mr-status">${sentence.map(function (x, i) { return typeof x === 'string' ? x : html`<${Live} key=${i} value=${x.b} text=${x.b} />`; })}</p>
          ${ask ? html`<${AskCard} ask=${ask} m=${m} count=${asks.length} busy=${busy} error=${error} onAnswer=${answer} />` : null}
          <div className="mr-board">
            <div className="mr-board-lanes">
              <${Board} m=${m} world=${w} lay=${lay} flash=${flash} selId=${whyStep ? whyStep.id : selStep} onSelect=${setSelStep} />
            </div>
            <p className="mr-board-foot">${m.status === 'paused' ? 'Paused. Tell Lead when to pick it back up.' : m.status === 'done' ? 'This mission has finished.' : m.status === 'stopped' ? 'This mission was stopped.' : ask ? 'Waiting on your decision. Steps that don’t depend on it keep going.' : anyWork ? 'The team is working. This board updates as they finish.' : m.phase === 'monitoring' ? 'The plan is in place. Insight Analyst checks results every morning.' : 'Next steps start as soon as their inputs are ready.'}</p>
          </div>
          <${StepWhy} step=${whyStep} />
          <div className="mr-bay">
            <${Artifacts} world=${w} m=${m} camp=${camp} seg=${seg} flash=${flash} />
            <${Narration} m=${m} tick=${tick} />
            <${Counters} tot=${tot} camp=${camp} />
          </div>
        </div>
        <${LeadColumn} ...${leadProps} />
      </div>
    </section>`;
  }

  MC.views.missions = MissionRoom;
})();
