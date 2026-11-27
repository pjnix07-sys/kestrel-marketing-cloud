/* Marketing Cloud - Team (#team; still MC.views.agents): each agent as a working teammate (what it is doing now and on which
   mission, hand-offs, record, settings behind a disclosure). Activity, Approvals, Guardrails and Run history remain reachable
   and exported on MC.views.teamParts.
   Run traces read as plain language (what the agent saw, what it decided, what changed) and are
   rendered from data fields only (step text, rows, rationale, optional summary), so richer
   explanations appear without code changes. No digests, no ticks, no simulation controls.
   Store reads use module-level selectors; editors live in useDraft; feed lists freeze while in use. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};

  var DASH = '–', DOT = '·', MID = ' · ', ELL = '…', TIMES = '×';
  var EMPTY = [];
  var TABS = ['roster', 'activity', 'approvals', 'guardrails', 'history'];

  function html() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }

  /* ---------- formatting (MC.fmt when present, plain fallbacks otherwise) ---------- */
  function commas(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function tryFmt(name, a, b) {
    try {
      if (MC.fmt && typeof MC.fmt[name] === 'function') { var r = MC.fmt[name](a, b); if (r != null) return String(r); }
    } catch (e) { /* fall back */ }
    return null;
  }
  function money(n, sign) {
    if (!fin(n)) return DASH;
    var s = tryFmt('money', Math.abs(n)) || ('$' + commas(n));
    if (sign) return (n > 0 ? '+' : (n < 0 ? '−' : '')) + s;
    return (n < 0 ? '-' : '') + s;
  }
  function num(n) { return fin(n) ? (tryFmt('num', n) || commas(n)) : DASH; }
  // One time format: relative within a day, otherwise "Wed, Nov 25, 7 pm".
  function stamp(t) {
    if (!fin(t)) return DASH;
    var d = tryFmt('date', t), h = tryFmt('hour', ((t % 24) + 24) % 24);
    if (d && h) return d + ', ' + h;
    var hh = ((t % 24) + 24) % 24;
    return 'Day ' + (Math.floor(t / 24) + 1) + ', ' + (hh % 12 === 0 ? 12 : hh % 12) + (hh < 12 ? ' am' : ' pm');
  }
  function rel(from, now) {
    if (!fin(from) || !fin(now)) return '';
    var r = tryFmt('rel', from, now);
    if (r) return r;
    var d = now - from, a = Math.abs(d);
    if (a < 1) return 'just now';
    var s = a < 48 ? a + 'h' : Math.round(a / 24) + 'd';
    return d >= 0 ? s + ' ago' : 'in ' + s;
  }
  function when(t, now) {
    if (!fin(t)) return DASH;
    return fin(now) && Math.abs(now - t) < 24 ? rel(t, now) : stamp(t);
  }
  function cadenceLabel(h) {
    if (!fin(h) || h <= 0) return DASH;
    if (h === 1) return 'Every hour';
    if (h === 168) return 'Every week';
    if (h === 24) return 'Every day';
    if (h % 24 === 0) return 'Every ' + (h / 24) + ' days';
    return 'Every ' + h + ' hours';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* ---------- names and labels ---------- */
  var AGENT_NAMES = {
    optimizer: 'Variant Optimizer', sendtime: 'Send-Time Tuner', pacer: 'Budget Pacer', guard: 'Fatigue Guard',
    analyst: 'Insight Analyst', copy: 'Copy Drafter', scout: 'Segment Scout', planner: 'Campaign Planner'
  };
  var AGENT_SHORT = {
    optimizer: 'Shifts traffic toward the variants that are winning.',
    sendtime: 'Moves sends to the hours people actually open.',
    pacer: 'Keeps spend on plan and moves budget to the channel returning the most.',
    guard: 'Rests people who are being messaged too much, before they unsubscribe.',
    analyst: 'Watches the numbers, flags surprises, and warns when a goal is at risk.',
    copy: 'Writes a fresh challenger when a winner tires or a test has settled.',
    scout: 'Finds pockets of customers who respond far better than average.',
    planner: 'Turns a brief into a full plan you can edit section by section.'
  };
  function agentDef(id) {
    try { return MC.runtime && typeof MC.runtime.def === 'function' ? MC.runtime.def(id) : null; } catch (e) { return null; }
  }
  function agentName(id) {
    if (!id) return '';
    if (id === 'user') return 'You';
    if (id === 'lead') return (MC.lead && MC.lead.NAME) || 'Lead';
    var d = agentDef(id);
    return (d && d.name) || AGENT_NAMES[id] || String(id);
  }
  var KIND_LABEL = {
    'traffic-shift': 'Traffic shift', 'pause-variant': 'Pause variant', 'send-time': 'Send time', 'adaptive-send': 'Adaptive send time',
    'budget-shift': 'Budget shift', 'fatigue-suppress': 'Fatigue rest', 'pause-channel': 'Pause channel', 'extend-campaign': 'Extend campaign',
    'new-variant': 'New variant', 'new-segment': 'New segment', retarget: 'Add audience', 'campaign-draft': 'Campaign draft', 'retire-block': 'Retire a tired block', 'block-test': 'Test a headline across channels', 'block-verdict': 'Move traffic off a losing headline', 'new-blocks': 'New content blocks'
  };
  var STATE_LABEL = { running: 'Running', paused: 'Paused', off: 'Off', queued: 'Queued run' };
  var AUTONOMY_LABEL = { off: 'Off', suggest: 'Suggest', autopilot: 'Autopilot' };
  var PROPOSAL_STATUS = {
    pending: { label: 'Waiting for you', tone: 'agent' }, auto: { label: 'Applied on Autopilot', tone: 'good' },
    applied: { label: 'Approved by you', tone: 'good' }, rejected: { label: 'Dismissed', tone: 'neutral' },
    undone: { label: 'Undone', tone: 'neutral' }, expired: { label: 'Expired unreviewed', tone: 'neutral' },
    superseded: { label: 'Replaced by a newer suggestion', tone: 'neutral' }, stale: { label: 'No longer applies', tone: 'warn' }
  };
  var NOTIFY_OPTS = [
    { value: 'all', label: 'Every update' },
    { value: 'changes', label: 'Only changes it makes' },
    { value: 'silent', label: "Don't notify me" }
  ];

  /* ---------- actions ---------- */
  function go(route, patch) {
    try {
      if (MC.nav && typeof MC.nav.go === 'function') MC.nav.go(route, patch);
      else window.location.hash = '#' + route;
    } catch (e) { /* best effort */ }
  }
  function setFocus(patch) {
    try { if (MC.uiStore && typeof MC.uiStore.setFocus === 'function') { MC.uiStore.setFocus('agents', patch); MC.uiStore.setFocus('team', patch); } } catch (e) { /* noop */ }
  }
  function dispatch(type, payload) {
    try {
      if (!MC.store || typeof MC.store.dispatch !== 'function') return { ok: false, error: 'The workspace is still starting up.' };
      return MC.store.dispatch({ type: type, payload: payload }) || { ok: false, error: 'No response.' };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }
  function undoCheck(pid) {
    try {
      var w = MC.store && MC.store.getState ? MC.store.getState() : null;
      if (w && MC.runtime && typeof MC.runtime.undoCheck === 'function') return MC.runtime.undoCheck(w, pid) || { ok: true };
    } catch (e) { /* allow the attempt */ }
    return { ok: true };
  }
  function openEntity(ent) {
    if (!ent || !ent.id) return false;
    if (ent.kind === 'campaign') { go('campaigns', { mode: 'detail', id: ent.id, tab: 'overview' }); return true; }
    if (ent.kind === 'variant') { go('content', { variantId: ent.id }); return true; }
    if (ent.kind === 'segment') { go('audiences', { tab: 'segments', segmentId: ent.id }); return true; }
    return false;
  }

  /* ---------- store access: stable module-level selectors ---------- */
  function call(name, w, arg) {
    var f = MC.select && MC.select[name];
    if (typeof f !== 'function' || !w) return null;
    try { return arg === undefined ? f(w) : f(w, arg); } catch (e) { return null; }
  }
  function useSel(sel, eq) {
    var H = MC.hooks || {};
    if (typeof H.useSelect !== 'function') return undefined;
    return H.useSelect(function (w) { if (!w) return undefined; try { return sel(w); } catch (e) { return undefined; } }, eq);
  }
  function useUiSel(sel) {
    var H = MC.hooks || {};
    if (typeof H.useUi !== 'function') return undefined;
    return H.useUi(sel);
  }
  function selReady() { return true; }
  function selTick(w) { return w.meta ? w.meta.tick : 0; }
  function selRoster(w) {
    var r = call('agentRoster', w);
    if (r) return r;
    var A = w.agents;
    if (!A || !A.order) return EMPTY;
    return A.order.map(function (id) {
      var a = A.byId[id] || {};
      return { id: id, name: agentName(id), short: '', status: a.autonomy === 'off' ? 'off' : (a.status === 'paused' ? 'paused' : 'running'),
        agentStatus: a.status, autonomy: a.autonomy, cadence: a.cadence, lastRun: a.lastRunTick, nextRun: null, pending: 0, stats: a.stats || {} };
    });
  }
  function selAgents(w) { return w.agents || null; }
  function selAudit(w) { return (w.audit && w.audit.entries) || EMPTY; }
  function selFeed(w) { return w.feed || EMPTY; }
  function selProposals(w) { return w.proposals || null; }
  function selOpenCount(w) { return w.proposals && w.proposals.open ? w.proposals.open.length : 0; }
  function selGuardrails(w) { return w.guardrails || null; }
  function selImpact(w) { return call('agentImpact', w); }
  function selInsights(w) { return w.insights || EMPTY; }

  /* ---------- kit lookups with small fallbacks ---------- */
  function kit(name) { var c = MC.ui && MC.ui[name]; return typeof c === 'function' ? c : null; }
  function Btn(p) {
    var K = kit('Button');
    if (K) return html`<${K} id=${p.id} kind=${p.kind || 'secondary'} size=${p.size || 'sm'} onClick=${p.onClick} disabled=${p.disabled}
      title=${p.title} aria-expanded=${p['aria-expanded']} aria-controls=${p['aria-controls']} type="button">${p.children}<//>`;
    return html`<button type="button" id=${p.id} className=${cx('cn-btn', 'cn-btn-' + (p.kind || 'secondary'))} onClick=${p.onClick}
      disabled=${p.disabled} title=${p.title} aria-expanded=${p['aria-expanded']}>${p.children}</button>`;
  }
  function Link(p) {
    return html`<button type="button" id=${p.id} className=${cx('cn-link', p.className)} onClick=${p.onClick} disabled=${p.disabled}
      aria-expanded=${p['aria-expanded']} aria-controls=${p['aria-controls']} aria-label=${p['aria-label']}>${p.children}</button>`;
  }
  function Pill(p) {
    var K = kit('Pill');
    if (K) return html`<${K} tone=${p.tone || 'neutral'} size="sm">${p.children}<//>`;
    return html`<span className=${cx('cn-pill', 'is-' + (p.tone || 'neutral'))}>${p.children}</span>`;
  }
  function Dot(p) {
    var K = kit('StatusDot');
    if (K) return html`<${K} state=${p.state} label=${p.label} />`;
    return html`<span className=${cx('cn-dot', 'is-' + p.state)} aria-hidden="true"></span>`;
  }
  function Empty(p) {
    var K = kit('EmptyState');
    if (K) return html`<${K} title=${p.title} body=${p.body} action=${p.action} compact=${p.compact} />`;
    return html`<div className="cn-empty"><p className="cn-empty-title">${p.title}</p>${p.body ? html`<p className="cn-empty-body">${p.body}</p>` : null}${p.action || null}</div>`;
  }
  function SelectBox(p) {
    var K = kit('Select');
    if (K) return html`<${K} id=${p.id} label=${p.label} value=${p.value} options=${p.options} onChange=${p.onChange} size="sm" />`;
    return html`<select id=${p.id} aria-label=${p.label} className="cn-select" value=${p.value} onChange=${function (e) { p.onChange(e.target.value); }}>
      ${p.options.map(function (o) { return html`<option key=${o.value} value=${o.value}>${o.label}</option>`; })}
    </select>`;
  }
  function Seg(p) {
    var K = kit('Segmented');
    if (K) return html`<${K} id=${p.id} label=${p.label} options=${p.options} value=${p.value} onChange=${p.onChange} size="sm" />`;
    return html`<div role="radiogroup" aria-label=${p.label} id=${p.id} className="cn-seg">
      ${p.options.map(function (o) {
        var on = o.value === p.value;
        return html`<button key=${o.value} type="button" role="radio" aria-checked=${on ? 'true' : 'false'} id=${p.id + '-' + o.value}
          className=${cx('cn-seg-opt', on && 'is-on')} onClick=${function () { p.onChange(o.value); }}>${o.label}</button>`;
      })}
    </div>`;
  }
  function Confirm(p) {
    var K = kit('InlineConfirm');
    if (K) return html`<${K} id=${p.id} message=${p.message} confirmLabel=${p.confirmLabel} cancelLabel=${p.cancelLabel || 'Cancel'}
      onConfirm=${p.onConfirm} onCancel=${p.onCancel} tone=${p.tone} />`;
    return html`<span className="cn-confirm" role="group">${p.message}
      <${Btn} kind="primary" onClick=${p.onConfirm}>${p.confirmLabel}<//><${Link} onClick=${p.onCancel}>Cancel<//></span>`;
  }

  // Freezes a list while the pointer or keyboard focus is inside it.
  function useInUse() {
    var React = R();
    var hs = React.useState(false), fs = React.useState(false);
    return {
      active: hs[0] || fs[0],
      props: {
        onMouseEnter: function () { hs[1](true); }, onMouseLeave: function () { hs[1](false); },
        onFocus: function () { fs[1](true); },
        onBlur: function (e) { if (!e.currentTarget.contains(e.relatedTarget)) fs[1](false); }
      }
    };
  }
  function useFrozenList(list, freeze) {
    var H = MC.hooks || {};
    if (typeof H.useFrozen === 'function') return H.useFrozen(list, { key: 'id', freeze: freeze });
    return { items: list, pending: 0, reveal: function () {} };
  }

  /* ---------- agent facts ---------- */
  function displayName(r) { return r && r.name && r.name !== r.id ? r.name : agentName(r && r.id); }
  function loaded(id) {
    try { return !(MC.runtime && typeof MC.runtime.def === 'function') || !!MC.runtime.def(id); } catch (e) { return true; }
  }
  function stateOf(row) {
    if (row && !loaded(row.id)) return 'off';
    var s = row && row.status;
    return STATE_LABEL[s] ? s : (row && row.autonomy === 'off' ? 'off' : (row && row.agentStatus === 'paused' ? 'paused' : 'running'));
  }
  function whenLine(row, tick) {
    var bits = [];
    if (row.awaiting) { bits.push('Thinking' + ELL); return bits.join(MID); }
    bits.push(fin(row.lastRun) ? 'Ran ' + rel(row.lastRun, tick) : 'Not run yet');
    var st = stateOf(row);
    if (st === 'queued') bits.push('runs next');
    else if (st === 'running' && fin(row.nextRun)) bits.push('next ' + rel(row.nextRun, tick));
    return bits.join(MID);
  }
  function trackRecord(row, impact) {
    var s = row.stats || {};
    var applied = (s.applied || 0) + (s.auto || 0), undone = s.undone || 0;
    var exp = 0, real = 0, nReal = 0, measuring = 0;
    ((impact && impact.rows) || EMPTY).forEach(function (r) {
      if (r.agentId !== row.id || r.unit !== '$') return;
      if (r.status === 'realized' && fin(r.realized)) { real += r.realized; if (fin(r.expected)) exp += r.expected; nReal++; }
      else if (r.status === 'measuring') measuring++;
    });
    var parts = [plural(applied, 'change') + ' applied'];
    if (undone) parts.push(undone + ' undone');
    if (nReal) parts.push('realized ' + money(real, true) + ' of expected ' + money(exp, true));
    else if (measuring) parts.push(measuring + ' still measuring');
    return { text: parts.join(MID), applied: applied };
  }

  /* ================= Plain-language run story ================= */
  function rowCells(r) {
    if (Array.isArray(r)) return r;
    if (r && typeof r === 'object') {
      if ('label' in r) return [r.label, r.value];
      if ('proposal' in r && 'result' in r) return [r.proposal, r.result];
      return Object.keys(r).map(function (k) { return r[k]; });
    }
    return [r];
  }
  function cellText(v) {
    if (v == null) return DASH;
    if (typeof v === 'number') return fin(v) ? (Math.abs(v) >= 1000 ? num(v) : String(Math.round(v * 1000) / 1000)) : DASH;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.map(cellText).join(', ');
    if (typeof v === 'object') return Object.keys(v).map(function (k) { return k + ' ' + cellText(v[k]); }).join(', ');
    return String(v);
  }
  function StepRows(p) {
    var rows = (p.rows || EMPTY).slice(0, 40);
    if (!rows.length) return null;
    return html`<div className="cn-rows k-scroll-x"><table className="cn-rows-table num"><tbody>
      ${rows.map(function (r, i) {
        return html`<tr key=${i}>${rowCells(r).map(function (c, j) { return html`<td key=${j}>${cellText(c)}</td>`; })}</tr>`;
      })}
    </tbody></table></div>`;
  }
  function stepText(s) { return s && (s.explanation || s.text || ''); }

  var ENTITY_KINDS = { campaign: 1, variant: 1, segment: 1 };
  function ChangeItem(p) {
    var React = R();
    var pr = p.proposal;
    var es = React.useState(null), err = es[0], setErr = es[1];
    var gs = React.useState(false), showGr = gs[0], setShowGr = gs[1];
    var st = PROPOSAL_STATUS[pr.status] || { label: pr.status, tone: 'neutral' };
    var Impact = kit('ImpactBadge'), GL = kit('GuardrailList');
    var applied = pr.status === 'auto' || pr.status === 'applied';
    var uc = applied ? undoCheck(pr.id) : null;
    function undo() {
      setErr(null);
      var r = dispatch('proposal/undo', { id: pr.id });
      if (!r.ok) setErr(r.error || "Couldn't undo this change.");
    }
    var grId = 'agents-change-' + pr.id + '-guardrails';
    return html`<li className="cn-change">
      <div className="cn-change-head">
        <span className="cn-change-title">${pr.title}</span>
        <${Pill} tone=${st.tone}>${st.label}<//>
      </div>
      ${pr.explanation || pr.rationale ? html`<p className="cn-change-why">${pr.explanation || pr.rationale}</p>` : null}
      ${Impact && pr.impact ? html`<div className="cn-change-impact"><${Impact} impact=${pr.impact} realized=${pr.realized} measuring=${applied && !pr.realized} /></div>` : null}
      <div className="cn-change-actions">
        ${applied && uc && uc.ok ? html`<${Btn} size="sm" onClick=${undo}>Undo<//>` : null}
        ${applied && uc && !uc.ok && uc.reason ? html`<span className="cn-muted">${uc.reason}</span>` : null}
        ${pr.status === 'pending' ? html`<${Btn} size="sm" onClick=${function () { setFocus({ tab: 'approvals' }); }}>Review<//>` : null}
        ${GL && pr.guardrails && pr.guardrails.length ? html`<${Link} onClick=${function () { setShowGr(!showGr); }} aria-expanded=${showGr ? 'true' : 'false'} aria-controls=${grId}>
          ${showGr ? 'Hide guardrails' : 'Guardrails checked (' + pr.guardrails.length + ')'}<//>` : null}
        ${pr.target && ENTITY_KINDS[pr.target.kind] ? html`<${Link} onClick=${function () { openEntity(pr.target); }}>View<//>` : null}
      </div>
      ${showGr && GL ? html`<div id=${grId} className="cn-change-guards"><${GL} items=${pr.guardrails} /></div>` : null}
      ${err ? html`<p className="cn-error" role="alert">${err}</p>` : null}
    </li>`;
  }

  function RunStory(p) {
    var entry = p.entry;
    var byId = useSel(function (w) { return w.proposals ? w.proposals.byId : null; });
    var insights = useSel(selInsights) || EMPTY;
    var tick = useSel(selTick) || 0;
    if (!entry) return html`<p className="cn-muted">This run is no longer in the history.</p>`;
    var trace = entry.trace || EMPTY;
    function of(k) { return trace.filter(function (s) { return s && s.step === k; }); }
    var saw = of('observe'), decided = of('decide'), checks = of('guardrails');
    var props = (entry.proposals || EMPTY).map(function (id) { return byId ? byId[id] : null; }).filter(Boolean);
    var ins = (entry.insights || EMPTY).map(function (id) {
      for (var i = 0; i < insights.length; i++) if (insights[i].id === id) return insights[i];
      return null;
    }).filter(Boolean);
    var why = entry.reason === 'runNow' ? 'because you asked it to run now' : 'on its regular schedule';
    return html`<div className="cn-story" aria-label=${'How ' + agentName(entry.agentId) + ' decided'}>
      <p className="cn-story-lede">${agentName(entry.agentId) + ' ran ' + when(entry.tick, tick) + ' ' + why + '.'}</p>
      ${typeof entry.summary === 'string' && entry.summary ? html`<p className="cn-story-summary">${entry.summary}</p>` : null}
      ${entry.error ? html`<p className="cn-error">${'This run stopped early and changed nothing: ' + entry.error}</p>` : null}
      <div className="cn-story-sec">
        <h4 className="cn-story-h">What it saw</h4>
        ${saw.length ? saw.map(function (s, i) {
          return html`<div key=${'o' + i} className="cn-story-text">${stepText(s)}<${StepRows} rows=${s.rows} /></div>`;
        }) : html`<p className="cn-muted">Nothing new to look at this time.</p>`}
      </div>
      <div className="cn-story-sec">
        <h4 className="cn-story-h">What it decided, and why</h4>
        ${decided.length ? html`<ol className="cn-story-list">${decided.map(function (s, i) {
          return html`<li key=${'d' + i}>${stepText(s)}<${StepRows} rows=${s.rows} /></li>`;
        })}</ol>` : html`<p className="cn-muted">Nothing was worth changing.</p>`}
        ${checks.map(function (s, i) {
          return html`<div key=${'g' + i} className="cn-story-text">${stepText(s)}<${StepRows} rows=${s.rows} /></div>`;
        })}
      </div>
      <div className="cn-story-sec">
        <h4 className="cn-story-h">What changed</h4>
        ${props.length ? html`<ul className="cn-changes">${props.map(function (q) { return html`<${ChangeItem} key=${q.id} proposal=${q} />`; })}</ul>` : null}
        ${ins.length ? html`<ul className="cn-insights">${ins.map(function (x) {
          return html`<li key=${x.id}><span className="cn-insight-title">${x.title}</span>${x.body ? html`<span className="cn-muted"> ${x.body}</span>` : null}</li>`;
        })}</ul>` : null}
        ${!props.length && !ins.length ? html`<p className="cn-muted">Nothing changed.</p>` : null}
      </div>
    </div>`;
  }

  function engineLabel(e) { return e && e.engine === 'ai' ? 'Claude' : 'Rules'; }
  function aiOn() { try { return !!(MC.ai && MC.ai.isOn && MC.ai.isOn()); } catch (e) { return false; } }
  function useAiOn() {
    var React = R();
    var s = React.useState(aiOn), setS = s[1];
    React.useEffect(function () {
      if (!MC.ai || typeof MC.ai.subscribe !== 'function') return undefined;
      var un = MC.ai.subscribe(function () { setS(aiOn()); });
      setS(aiOn());
      return function () { if (typeof un === 'function') un(); };
    }, []);
    return s[0];
  }
  function selAwaiting(w) {
    var A = w.agents, out = [];
    if (!A || !A.order) return '';
    A.order.forEach(function (id) {
      var a = A.byId[id], st = null;
      try { st = MC.runtime && MC.runtime.statusOf ? MC.runtime.statusOf(w, id) : null; } catch (e) { st = null; }
      if ((st && st.awaiting) || (a && a.aiAwait)) out.push(id);
    });
    return out.join(',');
  }
  function selAiModes(w) {
    var A = w.agents, out = [];
    if (!A || !A.order) return '';
    A.order.forEach(function (id) { var a = A.byId[id]; if (a && a.aiMode === 'rules') out.push(id); });
    return out.join(',');
  }

  function runOutcome(e) {
    if (e.error) return 'Stopped early';
    var n = (e.proposals || EMPTY).length, applied = 0;
    (e.dispatched || EMPTY).forEach(function (d, i, arr) {
      if (d.applied && (i === 0 || arr[i - 1].proposalId !== d.proposalId)) applied++;
    });
    var bits = [];
    if (applied) bits.push(applied + ' applied');
    if (n - applied > 0) bits.push((n - applied) + ' suggested');
    var ni = (e.insights || EMPTY).length;
    if (ni) bits.push(plural(ni, 'insight'));
    return bits.length ? bits.join(', ') : 'No change';
  }

  /* ================= Roster ================= */
  function RosterRow(p) {
    var r = p.row, st = stateOf(r);
    return html`<li className=${cx('cn-roster-item', p.selected && 'is-selected')}>
      <button type="button" id=${'agents-row-' + r.id} className="cn-roster-btn" aria-current=${p.selected ? 'true' : null}
          onClick=${function () { setFocus({ agentId: r.id, auditId: null }); }}>
        <span className="cn-roster-main">
          <span className="cn-roster-name">${displayName(r)}</span>
          <span className="cn-roster-short">${r.short || (agentDef(r.id) || {}).short || AGENT_SHORT[r.id] || ''}</span>
          <span className="cn-roster-meta"><span>${(AUTONOMY_LABEL[r.autonomy] || DASH) + ', ' + cadenceLabel(r.cadence)}</span><span>${whenLine(r, p.tick)}</span></span>
        </span>
        <span className="cn-roster-side">
          <span className="cn-roster-state"><${Dot} state=${st} label=${null} />${loaded(r.id) ? STATE_LABEL[st] : 'Not loaded'}</span>
          ${r.pending > 0 ? html`<span className="cn-roster-pending num">${r.pending + ' waiting'}</span>` : null}
        </span>
      </button>
    </li>`;
  }

  function feedAgentId(it) { return it.agentId || null; }
  function runIdFor(it) { return it.agentId ? 'run-' + it.agentId + '-' + it.tick : null; }
  var AGENT_KINDS = { 'agent-applied': 1, 'agent-proposed': 1, insight: 1, anomaly: 1, approved: 1, undone: 1, rejected: 1 };

  function FeedRow(p) {
    var React = R();
    var it = p.item;
    var es = React.useState(null), err = es[0], setErr = es[1];
    var pr = p.proposals && it.proposalId ? p.proposals.byId[it.proposalId] : null;
    var canUndo = pr && (pr.status === 'auto' || pr.status === 'applied') && (it.kind === 'agent-applied' || it.kind === 'approved');
    function undo() {
      setErr(null);
      var r = dispatch('proposal/undo', { id: it.proposalId });
      if (!r.ok) setErr(r.error || "Couldn't undo this change.");
    }
    var runId = it.kind === 'agent-applied' || it.kind === 'agent-proposed' || it.kind === 'insight' || it.kind === 'anomaly' ? runIdFor(it) : null;
    var who = it.agentId ? agentName(it.agentId) : (it.kind === 'user' ? 'You' : null);
    return html`<li className="cn-feed-item">
      <p className="cn-feed-text">${it.text}</p>
      <p className="cn-feed-meta">
        ${who ? html`<span className=${it.agentId ? 'cn-agent-name' : null}>${who}</span>` : null}
        ${who ? html`<span aria-hidden="true">${MID}</span>` : null}
        <span className="num">${rel(it.tick, p.tick)}</span>
        ${it.entity && ENTITY_KINDS[it.entity.kind] ? html`<${Link} onClick=${function () { openEntity(it.entity); }}>View<//>` : null}
        ${canUndo ? html`<${Link} onClick=${undo}>Undo<//>` : null}
        ${runId ? html`<${Link} onClick=${function () { setFocus({ tab: 'roster', agentId: it.agentId, auditId: runId }); }}>How it decided<//>` : null}
      </p>
      ${err ? html`<p className="cn-error" role="alert">${err}</p>` : null}
    </li>`;
  }

  function RecentActivity(p) {
    var feed = useSel(selFeed) || EMPTY;
    var proposals = useSel(selProposals);
    var use = useInUse();
    var recent = React_useMemoSafe(function () {
      var out = [];
      for (var i = 0; i < feed.length && out.length < 6; i++) if (AGENT_KINDS[feed[i].kind]) out.push(feed[i]);
      return out;
    }, [feed]);
    var fz = useFrozenList(recent, use.active);
    var NP = kit('NewItemsPill');
    return html`<section className="cn-recent" aria-labelledby="agents-recent-title">
      <div className="cn-section-head">
        <h2 id="agents-recent-title" className="cn-h2">Recent activity</h2>
        <${Link} onClick=${function () { setFocus({ tab: 'activity' }); }}>See all activity<//>
      </div>
      ${fz.pending > 0 && NP ? html`<${NP} count=${fz.pending} onClick=${fz.reveal} />` : null}
      ${fz.items.length ? html`<ul className="cn-feed" ...${use.props}>${fz.items.map(function (it) {
        return html`<${FeedRow} key=${it.id} item=${it} tick=${p.tick} proposals=${proposals} />`;
      })}</ul>` : html`<p className="cn-muted">No agent changes or insights yet. They show up here as agents act.</p>`}
    </section>`;
  }
  function React_useMemoSafe(fn, deps) { return R().useMemo(fn, deps); }

  /* ---------- detail panel ---------- */
  function Reasoning(p) {
    var id = p.row.id, Seg = kit('Segmented'), on = useAiOn();
    var es = R().useState(null), msg = es[0], setMsg = es[1];
    function set(v) {
      var r = dispatch('agent/setAiMode', { id: id, aiMode: v });
      setMsg(r.ok ? null : { text: r.error || "Couldn't change how it reasons." });
    }
    var val = p.row.rulesOnly ? 'rules' : 'auto';
    var opts = [{ value: 'auto', label: 'Claude' }, { value: 'rules', label: 'Rules only' }];
    return html`<div className="cn-field-block">
      <span className="cn-label" id=${'agents-' + id + '-reasoning-label'}>Reasoning</span>
      ${Seg ? html`<${Seg} id=${'agents-' + id + '-reasoning'} label="Reasoning" size="sm" className="cn-reason-seg" options=${opts} value=${val} onChange=${set} />`
        : html`<span>${on && val !== 'rules' ? 'Claude' : 'Rules only'}</span>`}
      <p className="cn-muted cn-reason-note">${val === 'rules' ? 'This agent always uses its built-in rules.' : on ? 'Claude reasons about each run before this agent acts.' : 'Uses its built-in rules until you connect Claude.'}</p>
      ${msg ? html`<p className="cn-error" role="alert">${msg.text}</p>` : null}
    </div>`;
  }

  function Overview(p) {
    var React = R();
    var row = p.row, id = row.id, def = agentDef(id);
    var es = React.useState(null), msg = es[0], setMsg = es[1];
    var AC = kit('AutonomyControl');
    var cads = (MC.catalog && MC.catalog.CADENCES) || [1, 2, 3, 6, 12, 24, 48, 72, 168];
    var cd = def && def.cadence;
    var opts = cads.filter(function (c) { return !cd || ((cd.min === undefined || c >= cd.min) && (cd.max === undefined || c <= cd.max)); })
      .map(function (c) { return { value: String(c), label: cadenceLabel(c) }; });
    if (fin(row.cadence) && !opts.some(function (o) { return o.value === String(row.cadence); })) opts.unshift({ value: String(row.cadence), label: cadenceLabel(row.cadence) });
    var notify = useUiSel(function (s) { return s.notify ? s.notify[id] : null; }) || (def && def.notifyDefault) || 'changes';
    function setCadence(v) {
      var r = dispatch('agent/setCadence', { id: id, cadence: Number(v) });
      setMsg(r.ok ? null : { tone: 'crit', text: r.error || "Couldn't change how often it runs." });
    }
    function setNotify(v) { try { MC.uiStore.setNotify(id, v); } catch (e) { /* noop */ } }
    var impact = p.impact;
    var tr = trackRecord(row, impact);
    var waiting = row.pending || 0;
    return html`<div className="cn-overview">
      <div className="cn-field-block">
        <span className="cn-label" id=${'agents-' + id + '-autonomy-label'}>Autonomy</span>
        ${AC ? html`<${AC} agentId=${id} id=${'agents-' + id + '-autonomy'} />` : html`<span>${AUTONOMY_LABEL[row.autonomy] || DASH}</span>`}
      </div>
      ${row.rulesOnly !== undefined ? html`<${Reasoning} row=${row} />` : null}
      <div className="cn-two">
        <div className="cn-field-block">
          <label className="cn-label" htmlFor=${'agents-' + id + '-cadence'}>Schedule</label>
          ${def ? html`<${SelectBox} id=${'agents-' + id + '-cadence'} label="How often it runs" value=${String(row.cadence)} options=${opts} onChange=${setCadence} />`
            : html`<span className="num">${cadenceLabel(row.cadence)}</span>`}
        </div>
        <div className="cn-field-block">
          <label className="cn-label" htmlFor=${'agents-' + id + '-notify'}>Notify me</label>
          <${SelectBox} id=${'agents-' + id + '-notify'} label="Notifications" value=${notify} options=${NOTIFY_OPTS} onChange=${setNotify} />
        </div>
      </div>
      ${msg ? html`<p className="cn-error" role="alert">${msg.text}</p>` : null}
      <dl className="cn-facts">
        <div><dt>Last run</dt><dd className="num">${fin(row.lastRun) ? when(row.lastRun, p.tick) : 'Not run yet'}</dd></div>
        <div><dt>Next run</dt><dd className="num">${stateOf(row) === 'queued' ? 'Queued to run shortly' : (stateOf(row) === 'running' && fin(row.nextRun) ? rel(row.nextRun, p.tick) : (stateOf(row) === 'off' ? "Doesn't run while off" : 'Paused'))}</dd></div>
        <div><dt>Track record</dt><dd className="num">${tr.text}</dd></div>
        <div><dt>Waiting for you</dt><dd className="num">${waiting ? html`<${Link} onClick=${function () { setFocus({ tab: 'approvals' }); }}>${plural(waiting, 'suggestion')}<//>` : 'Nothing'}</dd></div>
      </dl>
    </div>`;
  }

  function RunsList(p) {
    var React = R();
    var id = p.agentId, entries = p.entries, auditId = p.auditId;
    var ls = React.useState(12), limit = ls[0], setLimit = ls[1];
    var cs = React.useState(false), onlyChanges = cs[0], setOnly = cs[1];
    var list = React.useMemo(function () {
      return entries.filter(function (e) {
        return e.agentId === id && (!onlyChanges || (e.proposals && e.proposals.length) || (e.insights && e.insights.length) || e.id === auditId);
      });
    }, [entries, id, onlyChanges, auditId]);
    var Check = kit('Checkbox');
    if (!list.length && !onlyChanges) return html`<p className="cn-muted">No runs yet. ${agentName(id)} runs ${cadenceLabel(p.cadence).toLowerCase()}.</p>`;
    var shown = list.slice(0, limit);
    if (auditId && !shown.some(function (e) { return e.id === auditId; })) {
      var sel = list.filter(function (e) { return e.id === auditId; })[0];
      if (sel) shown = [sel].concat(shown);
    }
    return html`<div className="cn-runs">
      ${Check ? html`<${Check} id=${'agents-' + id + '-only-changes'} label="Only runs that changed something" checked=${onlyChanges} onChange=${setOnly} />` : null}
      <ul className="cn-run-list">
        ${shown.map(function (e) {
          var open = e.id === auditId, pid = 'agents-run-' + e.id;
          return html`<li key=${e.id} className=${cx('cn-run', open && 'is-open')}>
            <button type="button" className="cn-run-btn" aria-expanded=${open ? 'true' : 'false'} aria-controls=${pid}
                onClick=${function () { setFocus({ auditId: open ? null : e.id }); }}>
              <span className="cn-run-when num">${when(e.tick, p.tick)}</span>
              <span className="cn-run-out">${runOutcome(e)}<span className="cn-muted">${MID + engineLabel(e)}</span></span>
              <span className="cn-run-caret" aria-hidden="true">${open ? '−' : '+'}</span>
            </button>
            ${open ? html`<div id=${pid} className="cn-run-body"><${RunStory} entry=${e} /></div>` : null}
          </li>`;
        })}
      </ul>
      ${!list.length ? html`<p className="cn-muted">No runs changed anything yet.</p>` : null}
      ${list.length > limit ? html`<${Link} onClick=${function () { setLimit(limit + 20); }}>Show older runs<//>` : null}
    </div>`;
  }

  function paramShown(pd, v) { return pd.type === 'pct' && fin(pd.max) && pd.max <= 1 && fin(v) ? Math.round(v * 10000) / 100 : v; }
  function paramStored(pd, v) { return pd.type === 'pct' && fin(pd.max) && pd.max <= 1 && fin(v) ? Math.round(v * 100) / 10000 : v; }
  function paramText(pd, v) {
    if (pd.type === 'bool') return v ? 'On' : 'Off';
    var s = paramShown(pd, v);
    return fin(s) ? String(s) + (pd.type === 'pct' && fin(pd.max) && pd.max <= 1 ? '%' : '') : DASH;
  }

  function Settings(p) {
    var React = R();
    var id = p.agentId, def = agentDef(id);
    var current = useSel(function (w) { var a = w.agents && w.agents.byId[id]; return a ? a.params : null; }) || null;
    var H = MC.hooks || {};
    var draft = H.useDraft(current || {}, {
      onCommit: function (v) {
        var changed = {};
        Object.keys(v).forEach(function (k) { if (!current || v[k] !== current[k]) changed[k] = v[k]; });
        if (!Object.keys(changed).length) return { ok: true };
        return dispatch('agent/setParams', { id: id, params: changed });
      }
    });
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var rs = React.useState(false), confirmReset = rs[0], setConfirmReset = rs[1];
    var GL = kit('GuardrailList');
    if (!def) return html`<p className="cn-muted">Settings appear once ${agentName(id)} has loaded.</p>`;
    var keys = Object.keys(def.params || {});
    var errs = {};
    keys.forEach(function (k) {
      var v = draft.value[k];
      var e = MC.catalog && typeof MC.catalog.paramErr === 'function' ? MC.catalog.paramErr(def, k, v) : null;
      if (v == null && def.params[k].type !== 'bool') e = (def.params[k].label || k) + ' needs a value.';
      if (e) errs[k] = e;
    });
    var hasErr = Object.keys(errs).length > 0;
    function setVal(k, v) { setMsg(null); draft.set(function (d) { var n = Object.assign({}, d); n[k] = v; return n; }); }
    function save() {
      if (hasErr) return;
      var r = draft.commit();
      setMsg(r && r.ok === false ? { tone: 'crit', text: r.error || "Couldn't save." } : { tone: 'good', text: 'Saved. The next run uses these settings.' });
    }
    function reset() {
      var r = dispatch('agent/resetParams', { id: id });
      setConfirmReset(false);
      if (r.ok) { draft.takeTheirs(); setMsg({ tone: 'good', text: 'Back to defaults.' }); }
      else setMsg({ tone: 'crit', text: r.error || "Couldn't reset." });
    }
    var NI = kit('NumberInput'), Check = kit('Checkbox'), Field = kit('Field');
    var grIds = (def.guardrails || EMPTY).slice();
    ['consent', 'protectDrafts', 'targetFresh', 'holdout'].forEach(function (g) { if (grIds.indexOf(g) < 0) grIds.push(g); });
    var grItems = grIds.map(function (g) {
      var gd = MC.guardrails && typeof MC.guardrails.get === 'function' ? MC.guardrails.get(g) : null;
      return gd ? { id: g, label: gd.label || g, status: 'pass', detail: gd.rule || '', locked: !!gd.immutable } : null;
    }).filter(Boolean);
    return html`<div className="cn-settings">
      ${draft.conflict ? html`<p className="cn-conflict" role="status">These settings changed while you were editing.
        <${Link} onClick=${draft.takeTheirs}>Use the latest<//><${Link} onClick=${draft.keepMine}>Keep mine<//></p>` : null}
      ${keys.length ? html`<div className="cn-params">
        ${keys.map(function (k) {
          var pd = def.params[k], fid = 'agents-' + id + '-param-' + k, v = draft.value[k];
          var hint = (pd.help ? pd.help + ' ' : '') + 'Default ' + paramText(pd, pd['default']) +
            (pd.type !== 'bool' && fin(pd.min) && fin(pd.max) ? MID + 'range ' + paramText(pd, pd.min) + DASH + paramText(pd, pd.max) : '');
          if (pd.type === 'bool') {
            return html`<div key=${k} className="cn-param">${Check ? html`<${Check} id=${fid} label=${pd.label || k} hint=${hint} checked=${!!v} onChange=${function (b) { setVal(k, b); }} />`
              : html`<label><input type="checkbox" id=${fid} checked=${!!v} onChange=${function (e) { setVal(k, e.target.checked); }} /> ${pd.label || k}</label>`}</div>`;
          }
          var pctShown = pd.type === 'pct' && fin(pd.max) && pd.max <= 1;
          var input = NI ? html`<${NI} id=${fid} value=${paramShown(pd, v)} min=${paramShown(pd, pd.min)} max=${paramShown(pd, pd.max)}
              step=${pd.step ? paramShown(pd, pd.step) : (pd.type === 'int' ? 1 : 'any')} suffix=${pctShown ? '%' : null}
              onChange=${function (n) { setVal(k, n == null ? null : paramStored(pd, n)); }} />`
            : html`<input id=${fid} type="number" className="cn-input" value=${v == null ? '' : paramShown(pd, v)} onChange=${function (e) { setVal(k, e.target.value === '' ? null : paramStored(pd, Number(e.target.value))); }} />`;
          return html`<div key=${k} className="cn-param">${Field ? html`<${Field} id=${fid} label=${pd.label || k} hint=${hint} error=${errs[k]}>${input}<//>`
            : html`<label className="cn-label" htmlFor=${fid}>${pd.label || k}</label>${input}<p className="cn-muted">${hint}</p>`}</div>`;
        })}
      </div>` : html`<p className="cn-muted">This agent has no adjustable settings.</p>`}
      ${keys.length ? html`<div className="cn-form-actions">
        <${Btn} kind="primary" size="md" onClick=${save} disabled=${!draft.dirty || hasErr}>Save parameters<//>
        ${draft.dirty ? html`<${Link} onClick=${function () { draft.reset(); setMsg(null); }}>Discard changes<//>` : null}
        ${confirmReset ? html`<${Confirm} id=${'agents-' + id + '-reset-confirm'} message="Reset every setting to its default?" confirmLabel="Reset"
            onConfirm=${reset} onCancel=${function () { setConfirmReset(false); }} />`
          : html`<${Link} onClick=${function () { setConfirmReset(true); }}>Reset to defaults<//>`}
      </div>` : null}
      ${msg ? html`<p className=${msg.tone === 'crit' ? 'cn-error' : 'cn-ok'} role="status">${msg.text}</p>` : null}
      ${GL && grItems.length ? html`<div className="cn-settings-guards">
        <h3 className="cn-h3">Guardrails it must pass</h3>
        <p className="cn-muted">Every change is checked against these before it can apply. Edit the limits in the Guardrails tab.</p>
        <${GL} items=${grItems} ariaLabel=${'Guardrails for ' + agentName(id)} />
      </div>` : null}
    </div>`;
  }

  function AgentDetail(p) {
    var React = R();
    var row = p.row, id = row.id;
    var auditId = p.auditId;
    var ts = React.useState(auditId ? 'runs' : 'overview'), sub = ts[0], setSub = ts[1];
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    React.useEffect(function () { if (auditId) setSub('runs'); }, [auditId]);
    React.useEffect(function () { setMsg(null); }, [id]);
    var st = stateOf(row);
    var paused = row.agentStatus === 'paused' || st === 'paused';
    function runNow() {
      var r = dispatch('agent/runNow', { id: id });
      setMsg(r.ok ? { tone: 'good', text: 'Queued. It runs within the hour and the result shows under Runs.' } : { tone: 'crit', text: r.error || "Couldn't start a run." });
    }
    function togglePause() {
      var r = dispatch('agent/setStatus', { id: id, status: paused ? 'active' : 'paused' });
      setMsg(r.ok ? null : { tone: 'crit', text: r.error || "Couldn't change the agent." });
    }
    var Tabs = kit('Tabs');
    var subTabs = [{ id: 'overview', label: 'Overview' }, { id: 'runs', label: 'Runs' }, { id: 'settings', label: 'Settings' }];
    var panelId = 'agents-detail-panel';
    var def = agentDef(id);
    return html`<section className="cn-detail" id="agents-detail" aria-labelledby="agents-detail-title">
      <header className="cn-detail-head">
        <div className="cn-detail-titles">
          <h2 id="agents-detail-title" className="cn-detail-title">${displayName(row)}</h2>
          <p className="cn-detail-short">${row.short || (def && def.short) || AGENT_SHORT[id] || ''}</p>
          <p className="cn-detail-state"><${Dot} state=${st} label=${null} /><span>${def ? (row.awaiting ? 'Thinking' + ELL : STATE_LABEL[st]) : 'Not available yet'}</span><span className="cn-muted num">${MID + whenLine(row, p.tick)}</span></p>
        </div>
        <div className="cn-detail-actions">
          <${Btn} kind="primary" size="md" id=${'agents-' + id + '-run'} onClick=${runNow} disabled=${!def || st === 'queued'}>${st === 'queued' ? 'Queued' : 'Run now'}<//>
          <${Btn} kind="secondary" size="md" id=${'agents-' + id + '-pause'} onClick=${togglePause}>${paused ? 'Resume agent' : 'Pause agent'}<//>
        </div>
      </header>
      ${msg ? html`<p className=${msg.tone === 'crit' ? 'cn-error' : 'cn-ok'} role="status">${msg.text}</p>` : null}
      ${Tabs ? html`<${Tabs} id="agents-detail-tabs" label=${'Details for ' + agentName(id)} size="sm" tabs=${subTabs} value=${sub} onChange=${setSub} panelId=${panelId} />` : null}
      <div id=${panelId} role="tabpanel" aria-labelledby=${'agents-detail-tabs-' + sub} className="cn-detail-body">
        ${sub === 'overview' ? html`<${Overview} row=${row} tick=${p.tick} impact=${p.impact} />` : null}
        ${sub === 'runs' ? html`<${RunsList} agentId=${id} entries=${p.entries} auditId=${auditId} tick=${p.tick} cadence=${row.cadence} />` : null}
        ${sub === 'settings' ? html`<${Settings} key=${id} agentId=${id} />` : null}
      </div>
    </section>`;
  }

  function RosterTab(p) {
    var roster = p.roster;
    var sel = roster.filter(function (r) { return r.id === p.agentId; })[0] || roster[0];
    var entries = useSel(selAudit) || EMPTY;
    var impact = useSel(selImpact);
    return html`<div className="cn-roster-grid">
      <section className="cn-area-roster" aria-labelledby="agents-roster-title">
        <h2 id="agents-roster-title" className="cn-sr">Roster</h2>
        <ul className="cn-roster" id="agents-roster">
          ${roster.map(function (r) { return html`<${RosterRow} key=${r.id} row=${r} tick=${p.tick} selected=${sel && r.id === sel.id} />`; })}
        </ul>
      </section>
      <div className="cn-area-detail">
        ${sel ? html`<${AgentDetail} key=${sel.id} row=${sel} tick=${p.tick} auditId=${sel.id === p.agentId ? p.auditId : null} entries=${entries} impact=${impact} />` : null}
      </div>
      <div className="cn-area-recent"><${RecentActivity} tick=${p.tick} /></div>
    </div>`;
  }

  /* ================= Activity ================= */
  var ACT_KINDS = [
    { value: 'all', label: 'All' },
    { value: 'changes', label: 'Changes', kinds: { 'agent-applied': 1, approved: 1, undone: 1 } },
    { value: 'suggestions', label: 'Suggestions', kinds: { 'agent-proposed': 1, rejected: 1 } },
    { value: 'insights', label: 'Insights', kinds: { insight: 1, anomaly: 1 } },
    { value: 'yours', label: 'Your actions', kinds: { user: 1, approved: 1, rejected: 1, undone: 1 } }
  ];
  function ActivityTab(p) {
    var React = R();
    var feed = useSel(selFeed) || EMPTY;
    var proposals = useSel(selProposals);
    var as = React.useState('all'), agent = as[0], setAgent = as[1];
    var ks = React.useState('all'), kind = ks[0], setKind = ks[1];
    var ps = React.useState(false), paused = ps[0], setPaused = ps[1];
    var ls = React.useState(60), limit = ls[0], setLimit = ls[1];
    var use = useInUse();
    var kdef = ACT_KINDS.filter(function (k) { return k.value === kind; })[0];
    var list = React.useMemo(function () {
      return feed.filter(function (it) {
        if (agent !== 'all' && feedAgentId(it) !== agent) return false;
        if (kdef && kdef.kinds && !kdef.kinds[it.kind]) return false;
        return true;
      });
    }, [feed, agent, kind]);
    var fz = useFrozenList(list, paused || use.active);
    var NP = kit('NewItemsPill');
    var agentOpts = [{ value: 'all', label: 'All agents' }].concat(p.roster.map(function (r) { return { value: r.id, label: displayName(r) }; }));
    var shown = fz.items.slice(0, limit);
    return html`<div className="cn-activity">
      <div className="cn-toolbar">
        <${SelectBox} id="agents-activity-agent" label="Filter by agent" value=${agent} options=${agentOpts} onChange=${setAgent} />
        <${Seg} id="agents-activity-kind" label="Filter by kind" options=${ACT_KINDS.map(function (k) { return { value: k.value, label: k.label }; })} value=${kind} onChange=${setKind} />
        <span className="cn-live">
          <span className=${cx('cn-live-dot', paused && 'is-paused')} aria-hidden="true"></span>
          <span>${paused ? 'Stream paused' : 'Live'}</span>
          <${Link} id="agents-activity-pause" onClick=${function () { if (paused) fz.reveal(); setPaused(!paused); }}>${paused ? 'Resume stream' : 'Pause stream'}<//>
        </span>
      </div>
      ${fz.pending > 0 && NP ? html`<${NP} count=${fz.pending} onClick=${fz.reveal} />` : null}
      ${shown.length ? html`<ul className="cn-feed cn-feed-full" ...${use.props}>${shown.map(function (it) {
        return html`<${FeedRow} key=${it.id} item=${it} tick=${p.tick} proposals=${proposals} />`;
      })}</ul>` : html`<${Empty} title="Nothing here yet" body="Agent changes, suggestions and insights appear here as they happen." />`}
      ${fz.items.length > limit ? html`<${Link} onClick=${function () { setLimit(limit + 60); }}>Show older activity<//>` : null}
    </div>`;
  }

  /* ================= Approvals ================= */
  var RISK_OPTS = [{ value: 'all', label: 'Any risk' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }];
  function ApprovalsTab(p) {
    var React = R();
    var P = useSel(selProposals);
    var ss = React.useState('needs'), sub = ss[0], setSub = ss[1];
    var as = React.useState('all'), agent = as[0], setAgent = as[1];
    var rs = React.useState('all'), risk = rs[0], setRisk = rs[1];
    var ks = React.useState('all'), kind = ks[0], setKind = ks[1];
    var cs = React.useState(false), confirm = cs[0], setConfirm = cs[1];
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var ls = React.useState(20), limit = ls[0], setLimit = ls[1];
    var use = useInUse();
    var lists = React.useMemo(function () {
      var out = { needs: [], applied: [], history: [], kinds: {} };
      if (!P) return out;
      (P.order || EMPTY).forEach(function (id) {
        var x = P.byId[id];
        if (!x) return;
        out.kinds[x.kind] = 1;
        if (agent !== 'all' && x.agentId !== agent) return;
        if (risk !== 'all' && x.risk !== risk) return;
        if (kind !== 'all' && x.kind !== kind) return;
        var item = { id: x.id, risk: x.risk };
        if (x.status === 'pending') out.needs.push(item);
        else if (x.status === 'auto' || x.status === 'applied') out.applied.push(item);
        else out.history.push(item);
      });
      return out;
    }, [P, agent, risk, kind]);
    var who = useUiSel(function (s) { return s.persona || 'admin'; }) || 'admin';
    var canApprove = !(MC.catalog && MC.catalog.can) || MC.catalog.can(who, 'approve');
    var DN = MC.ui && MC.ui.DecisionNote, DM = MC.ui && MC.ui.DecisionMeta;
    var list = lists[sub] || EMPTY;
    var fz = useFrozenList(list, use.active);
    var low = !canApprove ? [] : lists.needs.filter(function (x) { return x.risk === 'low'; }).map(function (x) { return x.id; });
    var Card = kit('ProposalCard'), Tabs = kit('Tabs'), NP = kit('NewItemsPill');
    function approveLow() {
      var r = dispatch('proposal/approveMany', { ids: low });
      setConfirm(false);
      setMsg(r.ok ? { tone: 'good', text: 'Approved ' + plural(low.length, 'low-risk change') + '.' } : { tone: 'crit', text: r.error || "Couldn't approve these changes. Reload and try again." });
    }
    var kindOpts = [{ value: 'all', label: 'All kinds' }].concat(Object.keys(lists.kinds).sort().map(function (k) { return { value: k, label: KIND_LABEL[k] || k }; }));
    var agentOpts = [{ value: 'all', label: 'All agents' }].concat(p.roster.map(function (r) { return { value: r.id, label: displayName(r) }; }));
    var subTabs = [
      { id: 'needs', label: 'Needs you', count: lists.needs.length, countTone: lists.needs.length ? 'agent' : null },
      { id: 'applied', label: 'Applied', count: lists.applied.length },
      { id: 'history', label: 'Dismissed and expired' }
    ];
    var shown = fz.items.slice(0, limit);
    var EMPTY_COPY = {
      needs: ['Nothing needs you right now', 'Suggestions that need your decision show up here.'],
      applied: ['Nothing applied yet', 'Changes agents made on their own and suggestions you approved are listed here, each with Undo.'],
      history: ['Nothing dismissed or expired', 'Dismissed, undone and expired suggestions are kept here.']
    };
    return html`<div className="cn-approvals">
      ${Tabs ? html`<${Tabs} id="agents-approvals-tabs" label="Approval lists" size="sm" tabs=${subTabs} value=${sub} onChange=${function (v) { setSub(v); setLimit(20); }} panelId="agents-approvals-list" />` : null}
      <div className="cn-toolbar">
        <${SelectBox} id="agents-approvals-agent" label="Filter by agent" value=${agent} options=${agentOpts} onChange=${setAgent} />
        <${SelectBox} id="agents-approvals-kind" label="Filter by kind" value=${kind} options=${kindOpts} onChange=${setKind} />
        <${Seg} id="agents-approvals-risk" label="Filter by risk" options=${RISK_OPTS} value=${risk} onChange=${setRisk} />
        ${sub === 'needs' && low.length ? (confirm
          ? html`<${Confirm} id="agents-approve-low-confirm" message=${'Approve ' + plural(low.length, 'low-risk change') + '?'} confirmLabel="Approve all"
              onConfirm=${approveLow} onCancel=${function () { setConfirm(false); }} />`
          : html`<${Btn} id="agents-approve-low" onClick=${function () { setMsg(null); setConfirm(true); }}>${'Approve all low-risk (' + low.length + ')'}<//>`) : null}
      </div>
      ${msg ? html`<p className=${msg.tone === 'crit' ? 'cn-error' : 'cn-ok'} role="status">${msg.text}</p>` : null}
      <p className=${cx('cn-freeze-note', use.active && 'is-on')}>${use.active ? "Paused while you're here" + (fz.pending > 0 ? ' \u00b7 ' + fz.pending + ' new' : '') : ''}</p>
      ${fz.pending > 0 && NP ? html`<${NP} count=${fz.pending} onClick=${fz.reveal} />` : null}
      <div id="agents-approvals-list" role="tabpanel" aria-labelledby=${'agents-approvals-tabs-' + sub}>
        ${shown.length && Card ? html`<ul className="cn-cards" ...${use.props}>${shown.map(function (x) {
          var pr = P && P.byId ? P.byId[x.id] : null;
          return html`<li key=${x.id}><${Card} id=${x.id} showTarget=${true} flat=${true} />
            ${sub === 'needs' && DN && pr ? html`<${DN} id=${x.id} risk=${pr.risk} signoffs=${pr.signoffs} />` : null}
            ${sub !== 'needs' && DM && pr ? html`<${DM} p=${pr} />` : null}</li>`;
        })}</ul>` : html`<${Empty} title=${EMPTY_COPY[sub][0]} body=${EMPTY_COPY[sub][1]} />`}
        ${fz.items.length > limit ? html`<${Link} onClick=${function () { setLimit(limit + 20); }}>Show more<//>` : null}
      </div>
    </div>`;
  }

  /* ================= Guardrails ================= */
  var OWNED = [{ key: 'email', label: 'Email' }, { key: 'sms', label: 'SMS' }, { key: 'push', label: 'Push' }];
  function hourLabel(h) { return tryFmt('hour', h) || ((h % 12 || 12) + (h < 12 ? ' am' : ' pm')); }
  function guardPatch(base, v) {
    var patch = {};
    if (!base) return patch;
    var fc = {};
    OWNED.forEach(function (c) { if (v.freqCap[c.key] !== base.freqCap[c.key]) fc[c.key] = v.freqCap[c.key]; });
    if (Object.keys(fc).length) patch.freqCap = fc;
    var q = {};
    if (v.quiet.start !== base.quiet.start) q.start = v.quiet.start;
    if (v.quiet.end !== base.quiet.end) q.end = v.quiet.end;
    if (Object.keys(q).length) patch.quiet = q;
    ['maxShiftPct', 'minSample', 'maxDailySpend', 'holdoutPct'].forEach(function (k) { if (v[k] !== base[k]) patch[k] = v[k]; });
    var b = {}, bb = base.brand || {}, vb = v.brand || {};
    if ((vb.banned || EMPTY).join('\n') !== (bb.banned || EMPTY).join('\n')) b.banned = vb.banned;
    ['maxSubject', 'maxGrade', 'noAllCaps'].forEach(function (k) { if (vb[k] !== bb[k]) b[k] = vb[k]; });
    if (Object.keys(b).length) patch.brand = b;
    return patch;
  }
  function GuardrailsTab() {
    var React = R();
    var g = useSel(selGuardrails);
    var H = MC.hooks || {};
    var draft = H.useDraft(g, {
      onCommit: function (v) {
        var patch = guardPatch(g, v);
        if (!Object.keys(patch).length) return { ok: true };
        return dispatch('guardrails/update', { patch: patch });
      }
    });
    var ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var ws = React.useState(''), word = ws[0], setWord = ws[1];
    var v = draft.value;
    if (!v) return html`<${Empty} title="Guardrails are loading" />`;
    var NI = kit('NumberInput'), Field = kit('Field'), Check = kit('Checkbox'), CC = kit('ConflictChip'), GL = kit('GuardrailList'), TI = kit('TextInput');
    function upd(fn) { setMsg(null); draft.set(function (d) { var n = JSON.parse(JSON.stringify(d)); fn(n); return n; }); }
    function numField(id, label, hint, val, min, max, step, onSet, suffix, prefix) {
      var bad = !fin(val) || val < min || val > max || (step === 1 && Math.floor(val) !== val);
      var err = bad ? label + ' must be ' + (step === 1 ? 'a whole number ' : '') + 'between ' + min + ' and ' + max + '.' : null;
      var input = NI ? html`<${NI} id=${id} value=${val} min=${min} max=${max} step=${step} suffix=${suffix} prefix=${prefix} onChange=${onSet} />`
        : html`<input id=${id} type="number" className="cn-input" value=${val == null ? '' : val} onChange=${function (e) { onSet(e.target.value === '' ? null : Number(e.target.value)); }} />`;
      return { bad: bad, el: Field ? html`<${Field} id=${id} label=${label} hint=${hint} error=${err}>${input}<//>`
        : html`<div><label className="cn-label" htmlFor=${id}>${label}</label>${input}${err ? html`<p className="cn-error">${err}</p>` : null}</div>` };
    }
    var fields = [];
    var caps = OWNED.map(function (c) {
      var f = numField('agents-guard-cap-' + c.key, c.label, 'Messages per person in 7 days', v.freqCap[c.key], 1, 14, 1,
        function (n) { upd(function (d) { d.freqCap[c.key] = n; }); });
      fields.push(f); return f.el;
    });
    var qs = numField('agents-guard-quiet-start', 'Quiet hours start', hourLabel(fin(v.quiet.start) ? v.quiet.start : 0), v.quiet.start, 0, 23, 1, function (n) { upd(function (d) { d.quiet.start = n; }); });
    var qe = numField('agents-guard-quiet-end', 'Quiet hours end', hourLabel(fin(v.quiet.end) ? v.quiet.end : 0), v.quiet.end, 0, 23, 1, function (n) { upd(function (d) { d.quiet.end = n; }); });
    var shift = numField('agents-guard-maxshift', 'Max change per run', 'Share of traffic or budget an agent may move at once', v.maxShiftPct, 5, 50, 1, function (n) { upd(function (d) { d.maxShiftPct = n; }); }, '%');
    var sample = numField('agents-guard-minsample', 'Minimum sample', 'Sends needed before a variant can be paused', v.minSample, 100, 5000, 1, function (n) { upd(function (d) { d.minSample = n; }); });
    var spend = numField('agents-guard-spend', 'Daily spend cap', 'Most a campaign may spend in one day', v.maxDailySpend, 500, 10000, 1, function (n) { upd(function (d) { d.maxDailySpend = n; }); }, null, '$');
    var hold = numField('agents-guard-holdout', 'Control group', 'Share of each audience kept out of agent changes to measure impact', v.holdoutPct, 0, 20, 1, function (n) { upd(function (d) { d.holdoutPct = n; }); }, '%');
    var subj = numField('agents-guard-subject', 'Max subject length', 'Characters', v.brand.maxSubject, 30, 90, 1, function (n) { upd(function (d) { d.brand.maxSubject = n; }); });
    var grade = numField('agents-guard-grade', 'Reading grade', 'Highest school grade level for copy', v.brand.maxGrade, 4, 12, 0.5, function (n) { upd(function (d) { d.brand.maxGrade = n; }); });
    fields = fields.concat([qs, qe, shift, sample, spend, hold, subj, grade]);
    var bad = fields.some(function (f) { return f.bad; });
    var banned = v.brand.banned || EMPTY;
    var wordErr = null;
    var w = word.trim();
    if (w && w.length > 30) wordErr = 'Up to 30 characters.';
    else if (w && banned.length >= 30) wordErr = 'Up to 30 banned words.';
    function addWord() {
      if (!w || wordErr) return;
      if (banned.some(function (b) { return b.toLowerCase() === w.toLowerCase(); })) { setWord(''); return; }
      upd(function (d) { d.brand.banned = (d.brand.banned || []).concat([w]); });
      setWord('');
    }
    function save() {
      if (bad) return;
      var r = draft.commit();
      setMsg(r && r.ok === false ? { tone: 'crit', text: r.error || "Couldn't save guardrails." } : { tone: 'good', text: 'Guardrails saved. Agents check against them from their next run.' });
    }
    var locked = [
      { id: 'consent', label: 'Consent respected', detail: 'Agents never message a channel someone has not opted into', status: 'pass', locked: true },
      { id: 'protectDrafts', label: "Doesn't touch drafts", detail: 'Agents never change draft campaigns', status: 'pass', locked: true },
      { id: 'smsOptOut', label: 'SMS opt-out', detail: 'Every text ends with how to opt out', status: 'pass', locked: true }
    ];
    return html`<div className="cn-guards">
      <p className="cn-lede">Every agent change is checked against these limits. Anything that fails waits for you instead of applying.</p>
      ${draft.conflict && CC ? html`<${CC} agentId=${(g && g.updatedBy && String(g.updatedBy).indexOf('agent:') === 0) ? String(g.updatedBy).slice(6) : 'user'}
          onTheirs=${draft.takeTheirs} onMine=${draft.keepMine} />` : null}
      <section className="cn-guard-sec" aria-labelledby="agents-guard-reach">
        <h2 id="agents-guard-reach" className="cn-h2">Reaching people</h2>
        <div className="cn-grid3">${caps}</div>
        <div className="cn-grid3">${qs.el}${qe.el}<p className="cn-muted cn-quiet-note">${'No SMS or push between ' + hourLabel(fin(v.quiet.start) ? v.quiet.start : 0) + ' and ' + hourLabel(fin(v.quiet.end) ? v.quiet.end : 0) + '.'}</p></div>
      </section>
      <section className="cn-guard-sec" aria-labelledby="agents-guard-limits">
        <h2 id="agents-guard-limits" className="cn-h2">Limits on change</h2>
        <div className="cn-grid2">${shift.el}${sample.el}${spend.el}${hold.el}</div>
      </section>
      <section className="cn-guard-sec" aria-labelledby="agents-guard-brand">
        <h2 id="agents-guard-brand" className="cn-h2">Brand rules</h2>
        <div className="cn-field-block">
          <label className="cn-label" htmlFor="agents-guard-word">Banned words</label>
          <ul className="cn-chips" aria-label="Banned words">
            ${banned.map(function (b) {
              return html`<li key=${b} className="cn-chip"><span>${b}</span><button type="button" className="cn-chip-x" aria-label=${'Remove ' + b}
                onClick=${function () { upd(function (d) { d.brand.banned = d.brand.banned.filter(function (x) { return x !== b; }); }); }}>${TIMES}</button></li>`;
            })}
            ${!banned.length ? html`<li className="cn-muted">No banned words.</li>` : null}
          </ul>
          <div className="cn-addword">
            ${TI ? html`<${TI} id="agents-guard-word" value=${word} placeholder="Add a word or phrase" onChange=${setWord}
                onKeyDown=${function (e) { if (e.key === 'Enter') { e.preventDefault(); addWord(); } }} />`
              : html`<input id="agents-guard-word" className="cn-input" value=${word} onChange=${function (e) { setWord(e.target.value); }} />`}
            <${Btn} onClick=${addWord} disabled=${!w || !!wordErr}>Add<//>
          </div>
          ${wordErr ? html`<p className="cn-error">${wordErr}</p>` : null}
        </div>
        <div className="cn-grid2">${subj.el}${grade.el}</div>
        ${Check ? html`<${Check} id="agents-guard-caps" label="Flag copy written in all caps" checked=${!!v.brand.noAllCaps}
          onChange=${function (b) { upd(function (d) { d.brand.noAllCaps = b; }); }} />` : null}
      </section>
      <section className="cn-guard-sec" aria-labelledby="agents-guard-locked">
        <h2 id="agents-guard-locked" className="cn-h2">Always on</h2>
        ${GL ? html`<${GL} items=${locked} ariaLabel="Locked guardrails" />` : null}
      </section>
      <div className=${cx('cn-form-actions', draft.dirty && 'cn-sticky-actions')}>
        <${Btn} kind="primary" size="md" id="agents-guard-save" onClick=${save} disabled=${!draft.dirty || bad}>Save guardrails<//>
        ${draft.dirty ? html`<${Link} onClick=${function () { draft.reset(); setMsg(null); }}>Discard changes<//>` : html`<span className="cn-muted">No unsaved changes</span>`}
        ${msg ? html`<span className=${msg.tone === 'crit' ? 'cn-error' : 'cn-ok'} role="status">${msg.text}</span>` : null}
      </div>
    </div>`;
  }

  /* ================= Run history ================= */
  function HistoryTab(p) {
    var React = R();
    var entries = useSel(selAudit) || EMPTY;
    var as = React.useState('all'), agent = as[0], setAgent = as[1];
    var cs = React.useState(true), onlyChanges = cs[0], setOnly = cs[1];
    var ls = React.useState(30), limit = ls[0], setLimit = ls[1];
    var os = React.useState(null), open = os[0], setOpen = os[1];
    var use = useInUse();
    var list = React.useMemo(function () {
      return entries.filter(function (e) {
        if (agent !== 'all' && e.agentId !== agent) return false;
        if (onlyChanges && e.reason !== 'runNow' && !((e.proposals && e.proposals.length) || (e.insights && e.insights.length) || e.error)) return false;
        return true;
      });
    }, [entries, agent, onlyChanges]);
    var fz = useFrozenList(list, use.active);
    var Check = kit('Checkbox');
    var agentOpts = [{ value: 'all', label: 'All agents' }].concat(p.roster.map(function (r) { return { value: r.id, label: displayName(r) }; }));
    var shown = fz.items.slice(0, limit);
    return html`<div className="cn-history">
      <p className="cn-lede">Every agent run, newest first. Open one to read what the agent saw, what it decided and what changed.</p>
      <div className="cn-toolbar">
        <${SelectBox} id="agents-history-agent" label="Filter by agent" value=${agent} options=${agentOpts} onChange=${setAgent} />
        ${Check ? html`<${Check} id="agents-history-only" label="Only runs that changed something" checked=${onlyChanges} onChange=${setOnly} />` : null}
      </div>
      ${shown.length ? html`<ul className="cn-run-list" ...${use.props}>
        ${shown.map(function (e) {
          var isOpen = open === e.id, pid = 'agents-history-' + e.id;
          return html`<li key=${e.id} className=${cx('cn-run', isOpen && 'is-open')}>
            <button type="button" className="cn-run-btn cn-run-btn-wide" aria-expanded=${isOpen ? 'true' : 'false'} aria-controls=${pid}
                onClick=${function () { setOpen(isOpen ? null : e.id); }}>
              <span className="cn-run-agent">${agentName(e.agentId)}</span>
              <span className="cn-run-when num">${when(e.tick, p.tick)}</span>
              <span className="cn-run-out">${runOutcome(e) + (e.reason === 'runNow' ? MID + 'you asked' : '')}<span className="cn-muted">${MID + engineLabel(e)}</span></span>
              <span className="cn-run-caret" aria-hidden="true">${isOpen ? '−' : '+'}</span>
            </button>
            ${isOpen ? html`<div id=${pid} className="cn-run-body"><${RunStory} entry=${e} /></div>` : null}
          </li>`;
        })}
      </ul>` : html`<${Empty} title="No runs to show" body=${onlyChanges ? 'Runs that change something show up here. Clear the filter to see every run.' : 'Agents have not run yet.'} />`}
      ${fz.items.length > limit ? html`<${Link} onClick=${function () { setLimit(limit + 30); }}>Show older runs<//>` : null}
    </div>`;
  }

  /* ================= Team: each agent as a working teammate ================= */
  var LEAD_ID = 'lead';
  var ORDER = ['lead', 'scout', 'copy', 'guard', 'sendtime', 'pacer', 'planner', 'optimizer', 'analyst'];
  var GLYPH = {
    lead: '<path d="M8 1.5 14.5 8 8 14.5 1.5 8z"/>',
    planner: '<path d="M2 13.5 8 2.5l6 11z"/>',
    analyst: '<path d="M3 13.5V8.5M8 13.5v-10M13 13.5v-7"/>',
    scout: '<circle cx="8" cy="8" r="4.5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/>',
    copy: '<path d="M2 4h12M2 8h8M2 12h12"/>',
    guard: '<path d="M8 1.8 13.3 4v4c0 3-2.3 5-5.3 6.2C5 13 2.7 11 2.7 8V4z"/>',
    optimizer: '<path d="M2.5 2.5h4.5v11H2.5zM9 2.5h4.5v11H9z"/>',
    pacer: '<path d="M8 2a6 6 0 1 0 6 6H8z"/>',
    sendtime: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.6 1.8"/>'
  };
  var ROLE = {
    lead: 'Turns your goal into a plan, hands out the work, re-plans when results drift.'
  };
  var STATE_WORD = { work: 'Working', wait: 'Waiting on you', watch: 'Watching', idle: 'Idle', off: 'Off', paused: 'Paused' };

  function Mark(p) {
    return html`<svg className="tm-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML=${{ __html: GLYPH[p.id] || GLYPH.lead }}></svg>`;
  }
  function selMissionState(w) { return w.missions || null; }
  function missionsOf(ms) { return ms && ms.order ? ms.order.map(function (id) { return ms.byId[id]; }).filter(Boolean) : EMPTY; }
  function shortGoal(m) { return m.title || m.goalText || 'this mission'; }
  function missionHref(m) { return '#missions/' + encodeURIComponent(m.id); }
  function firstSentence(s) { s = String(s || ''); var i = s.search(/[.!?](\s|$)/); return i > 12 && i < s.length - 1 ? s.slice(0, i + 1) : s; }

  // What each agent is doing right now, its hand-offs and its voice, read from the missions' steps and beats.
  function deriveWork(missions, id, tick) {
    var now = null, waitAsk = null, lastDone = null, voice = null, hands = [], steps = 0, done = 0, asks = 0;
    var names = ORDER.map(function (a) { return { id: a, name: agentName(a) }; });
    missions.forEach(function (m) {
      var live = m.status !== 'stopped' && m.status !== 'done';
      (m.plan || EMPTY).forEach(function (s) {
        if (s.agentId !== id) return;
        steps++;
        if (s.status === 'done') {
          done++;
          if (!lastDone || (s.doneTick || 0) > (lastDone.s.doneTick || 0)) lastDone = { s: s, m: m };
        }
        if (live && s.status === 'working' && !now) now = { s: s, m: m };
        if (live && s.status === 'blocked' && !waitAsk) waitAsk = { s: s, m: m };
      });
      (m.asks || EMPTY).forEach(function (a) {
        if (a.agentId === id) asks++;
        if (live && a.agentId === id && a.status === 'open' && !waitAsk) waitAsk = { ask: a, m: m };
      });
      (m.log || EMPTY).forEach(function (b) {
        if (b.agentId === id && (!voice || b.tick >= voice.b.tick) && b.kind !== 'handoff') voice = { b: b, m: m };
        if (b.kind !== 'handoff') return;
        var to = null;
        names.forEach(function (n) { if (n.id !== b.agentId && b.text.indexOf(n.name) >= 0) to = n.id; });
        if (b.agentId === id) hands.push({ dir: 'out', other: to, b: b, m: m });
        else if (to === id) hands.push({ dir: 'in', other: b.agentId, b: b, m: m });
      });
    });
    hands.sort(function (a, z) { return z.b.tick - a.b.tick; });
    var state = 'idle', text = '', where = null;
    if (waitAsk) {
      state = 'wait'; where = waitAsk.m;
      text = waitAsk.ask ? waitAsk.ask.question : (waitAsk.s.note || waitAsk.s.title);
    } else if (now) {
      state = 'work'; where = now.m; text = now.s.title;
    } else if (voice && voice.m.phase === 'monitoring' && voice.m.status === 'running') {
      state = 'watch'; where = voice.m; text = firstSentence(voice.b.text);
    } else if (lastDone) {
      where = lastDone.m; text = 'Finished: ' + lastDone.s.title;
    }
    return { state: state, text: text, where: where, voice: voice, hands: hands.slice(0, 3), steps: steps, done: done, asks: asks, lastDone: lastDone, tick: tick };
  }

  function Hand(p) {
    var h = p.h, out = h.dir === 'out', other = h.other ? agentName(h.other) : (out ? 'the team' : 'the team');
    return html`<li className="tm-hand">
      <span className="tm-hand-who"><span className="tm-wire" aria-hidden="true">${out ? '→' : '←'}</span>
        <span className="sr-only tm-sr">${out ? 'To ' : 'From '}</span>${other}</span>
      <span className="tm-hand-text">${h.b.text}</span>
      <span className="tm-hand-meta num">${rel(h.b.tick, p.tick)}${h.m ? html` · <a href=${missionHref(h.m)}>${shortGoal(h.m)}</a>` : null}</span>
    </li>`;
  }

  function SettingsPanel(p) {
    var React = R();
    var row = p.row, id = p.id, ms = React.useState(null), msg = ms[0], setMsg = ms[1];
    var on = useAiOn();
    if (!row) {
      return html`<div className="tm-settings-body">
        <p className="tm-note">${on ? 'Lead plans from your own words with Claude, and checks every plan against your limits before anything moves.'
          : 'Lead plans with its built-in planner. Connect Claude and it plans from free text instead.'}</p>
        <p className="tm-note">Lead has no schedule: it acts when you set a goal, steer a mission or answer an ask.</p>
      </div>`;
    }
    var st = stateOf(row), paused = row.agentStatus === 'paused' || st === 'paused', def = agentDef(id);
    function runNow() {
      var r = dispatch('agent/runNow', { id: id });
      setMsg(r.ok ? { tone: 'good', text: 'Queued. It runs within the hour and the result shows under Runs.' } : { tone: 'crit', text: r.error || "Couldn't start a run." });
    }
    function togglePause() {
      var r = dispatch('agent/setStatus', { id: id, status: paused ? 'active' : 'paused' });
      setMsg(r.ok ? null : { tone: 'crit', text: r.error || "Couldn't change the agent." });
    }
    var rs = React.useState(!!p.auditId), showRuns = rs[0], setShowRuns = rs[1];
    var ps = React.useState(false), showParams = ps[0], setShowParams = ps[1];
    return html`<div className="tm-settings-body">
      <div className="tm-settings-actions">
        <${Btn} kind="secondary" size="md" id=${'agents-' + id + '-run'} onClick=${runNow} disabled=${!def || st === 'queued'}>${st === 'queued' ? 'Queued' : 'Run now'}<//>
        <${Btn} kind="secondary" size="md" id=${'agents-' + id + '-pause'} onClick=${togglePause}>${paused ? 'Resume agent' : 'Pause agent'}<//>
      </div>
      ${msg ? html`<p className=${msg.tone === 'crit' ? 'cn-error' : 'cn-ok'} role="status">${msg.text}</p>` : null}
      <${Overview} row=${row} tick=${p.tick} impact=${p.impact} />
      <div className="tm-sub-toggles">
        <${Link} aria-expanded=${showParams ? 'true' : 'false'} onClick=${function () { setShowParams(!showParams); }}>${showParams ? 'Hide parameters' : 'Parameters and guardrails it must pass'}<//>
        <${Link} aria-expanded=${showRuns ? 'true' : 'false'} onClick=${function () { setShowRuns(!showRuns); }}>${showRuns ? 'Hide runs' : 'Runs and how it decided'}<//>
      </div>
      ${showParams ? html`<${Settings} key=${id} agentId=${id} />` : null}
      ${showRuns ? html`<${RunsList} agentId=${id} entries=${p.entries} auditId=${p.auditId} tick=${p.tick} cadence=${row.cadence} />` : null}
    </div>`;
  }

  function TeamRow(p) {
    var React = R();
    var id = p.id, row = p.row, w = p.work, tick = p.tick;
    var os = React.useState(!!p.open), open = os[0], setOpen = os[1];
    React.useEffect(function () { if (p.open) setOpen(true); }, [p.open]);
    var name = row ? displayName(row) : agentName(id);
    var state = w.state;
    if (row) {
      var rs = stateOf(row);
      if (rs === 'off') state = 'off'; else if (rs === 'paused') state = 'paused';
      else if (row.awaiting && state === 'idle') state = 'work';
    }
    var role = (row && (row.short || (agentDef(id) || {}).short)) || ROLE[id] || AGENT_SHORT[id] || '';
    var sid = 'team-' + id + '-settings';
    var tr = row ? trackRecord(row, p.impact) : null, stat = row ? (row.stats || {}) : {};
    var realized = 0, expected = 0, nReal = 0;
    if (row) ((p.impact && p.impact.rows) || EMPTY).forEach(function (r) {
      if (r.agentId === id && r.unit === '$' && r.status === 'realized' && fin(r.realized)) { realized += r.realized; if (fin(r.expected)) expected += r.expected; nReal++; }
    });
    var applied = row ? (stat.applied || 0) + (stat.auto || 0) : w.done;
    var undone = row ? (stat.undone || 0) : 0;
    var nowText = w.text || (row && row.awaiting ? 'Thinking' + ELL : (role || 'Nothing on right now.'));
    return html`<li className=${cx('tm-row', 'is-' + state)} id=${'agents-row-' + id}>
      <div className="tm-id">
        <div className="tm-name"><span className="tm-led" aria-hidden="true"></span><${Mark} id=${id} /><h2 className="tm-h">${name}</h2></div>
        <p className="tm-state">${STATE_WORD[state]}${row && !loaded(id) ? '' : ''}</p>
        <p className="tm-role">${role}</p>
      </div>
      <div className="tm-now">
        <p className="tm-k">Right now</p>
        <p className="tm-now-text">${nowText}</p>
        ${w.where ? html`<p className="tm-on">${state === 'work' || state === 'wait' || state === 'watch' ? 'On ' : 'On '}<a href=${missionHref(w.where)}>${shortGoal(w.where)}</a></p>` : html`<p className="tm-on">${state === 'idle' ? 'Not on a mission' : ''}</p>`}
        ${w.voice && firstSentence(w.voice.b.text) !== firstSentence(nowText) ? html`<p className="tm-voice">“${firstSentence(w.voice.b.text)}” <span className="tm-voice-t num">${rel(w.voice.b.tick, tick)}</span></p>` : null}
      </div>
      <div className="tm-hands">
        <p className="tm-k">Hand-offs</p>
        ${w.hands.length ? html`<ul className="tm-hand-list">${w.hands.map(function (h, i) { return html`<${Hand} key=${i} h=${h} tick=${tick} />`; })}</ul>` : html`<p className="tm-none">None yet.</p>`}
      </div>
      <div className="tm-rec">
        <p className="tm-k">Record</p>
        <p className="tm-rec-main"><span className="tm-big num">${applied}</span> <span>${id === LEAD_ID ? 'steps handed out' : (applied === 1 ? 'change applied' : 'changes applied')}</span></p>
        <p className="tm-rec-sub num">${row ? (undone ? undone + ' undone' : 'None undone') : plural(w.asks, 'ask') + ' raised'}${nReal ? MID + 'realised ' + money(realized) + ' of ' + money(expected) + ' expected' : (row && tr && /measuring/.test(tr.text) ? MID + 'impact still measuring' : '')}</p>
        ${row && row.pending > 0 ? html`<p className="tm-rec-sub"><${Link} onClick=${function () { openAsks(); }}>${plural(row.pending, 'suggestion') + ' waiting for you'}<//></p>` : null}
      </div>
      <div className="tm-foot">
        <button type="button" className="tm-toggle" aria-expanded=${open ? 'true' : 'false'} aria-controls=${sid}
          onClick=${function () { setOpen(!open); }}>${open ? 'Hide settings' : 'Settings'}<span className="tm-toggle-sub">${row ? ' · ' + (AUTONOMY_LABEL[row.autonomy] || DASH) + ', ' + cadenceLabel(row.cadence).toLowerCase() : ''}</span></button>
      </div>
      ${open ? html`<div className="tm-settings" id=${sid}><${SettingsPanel} id=${id} row=${row} tick=${tick} impact=${p.impact} entries=${p.entries} auditId=${p.auditId} /></div>` : null}
    </li>`;
  }

  function openAsks() {
    try { if (MC.uiStore && typeof MC.uiStore.set === 'function') MC.uiStore.set({ drawer: 'approvals' }); } catch (e) { /* noop */ }
  }

  function TeamBoard(p) {
    var ms = useSel(selMissionState);
    var entries = useSel(selAudit) || EMPTY;
    var impact = useSel(selImpact);
    var missions = R().useMemo(function () { return missionsOf(ms); }, [ms]);
    var ids = R().useMemo(function () {
      var have = {}; p.roster.forEach(function (r) { have[r.id] = r; });
      var out = ORDER.filter(function (i) { return i === LEAD_ID || have[i]; });
      p.roster.forEach(function (r) { if (out.indexOf(r.id) < 0) out.push(r.id); });
      return out;
    }, [p.roster]);
    var byId = {}; p.roster.forEach(function (r) { byId[r.id] = r; });
    return html`<ol className="tm-list" aria-label="Your agents">
      ${ids.map(function (id) {
        return html`<${TeamRow} key=${id} id=${id} row=${byId[id] || null} work=${deriveWork(missions, id, p.tick)} tick=${p.tick}
          impact=${impact} entries=${entries} open=${p.focusId === id} auditId=${p.focusId === id ? p.auditId : null} />`;
      })}
    </ol>`;
  }

  /* ================= View ================= */
  var SUBNAV = [
    { id: 'team', label: 'Team' },
    { id: 'activity', label: 'Activity' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'history', label: 'Run history' }
  ];
  function TeamView() {
    var ready = useSel(selReady);
    var tick = useSel(selTick) || 0;
    var baseRoster = useSel(selRoster) || EMPTY;
    var waitingIds = useSel(selAwaiting) || '';
    var rulesIds = useSel(selAiModes) || '';
    var ms = useSel(selMissionState);
    var connected = useAiOn();
    var roster = React_useMemoSafe(function () {
      var w = waitingIds ? waitingIds.split(',') : [], r = rulesIds ? rulesIds.split(',') : [];
      return baseRoster.map(function (x) {
        return Object.assign({}, x, { awaiting: w.indexOf(x.id) >= 0, rulesOnly: r.indexOf(x.id) >= 0 });
      });
    }, [baseRoster, waitingIds, rulesIds]);
    var openCount = useSel(selOpenCount) || 0;
    var fTeam = useUiSel(function (s) { return s.focus && s.focus.team; }) || {};
    var fOld = useUiSel(function (s) { return s.focus && s.focus.agents; }) || {};
    var focus = Object.assign({}, fOld, fTeam);
    var tab = focus.tab === 'audit' ? 'history' : focus.tab;
    if (tab === 'roster' || TABS.indexOf(tab) < 0) tab = 'team';
    var missions = missionsOf(ms);
    var working = 0, asking = 0;
    ORDER.forEach(function (id) { var s = deriveWork(missions, id, tick).state; if (s === 'work') working++; if (s === 'wait') asking++; });
    var body;
    if (ready === undefined) body = html`<p className="cn-muted">Loading the team${ELL}</p>`;
    else if (tab === 'team') body = html`<${TeamBoard} roster=${roster} tick=${tick} focusId=${focus.agentId || null} auditId=${focus.auditId || null} />`;
    else if (tab === 'activity') body = html`<${ActivityTab} roster=${roster} tick=${tick} />`;
    else if (tab === 'approvals') body = html`<${ApprovalsTab} roster=${roster} tick=${tick} />`;
    else if (tab === 'guardrails') body = html`<${GuardrailsTab} />`;
    else body = html`<${HistoryTab} roster=${roster} tick=${tick} />`;
    var sub = (working ? working + ' working now' : 'Nothing running right now') + (asking ? MID + plural(asking, 'teammate') + ' waiting on you' : '') +
      (openCount ? MID + plural(openCount, 'suggestion') + ' to review' : '');
    return html`<section className="v-agents v-team">
      <header className="tm-head">
        <h1 id="page-title" tabIndex="-1" className="tm-title">Your team of nine</h1>
        <p className="cn-sr" role="status" aria-live="polite">${roster.filter(function (r) { return r.awaiting; }).map(function (r) { return displayName(r) + ' is thinking' + ELL; }).join(' ')}</p>
        <p className="tm-sub num">${sub}</p>
        ${!connected ? html`<p className="tm-sub tm-connect">Agents follow built-in rules for now. Connect Claude so they can explain their choices and write copy.</p>` : null}
        <nav className="tm-subnav" aria-label="Team sections">
          ${SUBNAV.map(function (s) {
            var on = s.id === tab;
            return html`<button key=${s.id} type="button" className=${cx('tm-subnav-btn', on && 'is-on')} aria-current=${on ? 'page' : null}
              onClick=${function () { setFocus({ tab: s.id === 'team' ? 'roster' : s.id, agentId: null, auditId: null }); }}>${s.label}${s.id === 'approvals' && openCount ? html` <span className="num">${openCount}</span>` : null}</button>`;
          })}
        </nav>
      </header>
      <div id="agents-panel" className="cn-panel">${body}</div>
    </section>`;
  }

  MC.views.agents = TeamView;
  MC.views.team = TeamView;
  // Approvals, activity, guardrails and run history stay available for reuse (the Asks drawer, deep links).
  MC.views.teamParts = {
    ApprovalsTab: ApprovalsTab, ActivityTab: ActivityTab, GuardrailsTab: GuardrailsTab, HistoryTab: HistoryTab,
    RunsList: RunsList, RunStory: RunStory, ChangeItem: ChangeItem, FeedRow: FeedRow, RecentActivity: RecentActivity,
    AgentMark: Mark, deriveWork: deriveWork
  };
})();
