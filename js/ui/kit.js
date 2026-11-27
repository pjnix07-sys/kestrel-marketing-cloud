/* Marketing Cloud - UI kit (MC.ui.*, `k-` classes) and the layout hooks
   MC.hooks.useWidth / useReducedMotion. Components are plain React function components used
   through htm:  html`<${MC.ui.Button} kind="primary" onClick=${fn}>Save<//>`.
   Colors come from css/tokens.css only (classes in css/app.css). */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.ui = MC.ui || {};
  MC.hooks = MC.hooks || {};
  var U = MC.ui;

  /* ---------------- helpers ---------------- */
  function R() { return window.React; }
  function H() { return MC.html; }
  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) { if (arguments[i]) out.push(arguments[i]); }
    return out.join(' ');
  }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function noop() {}
  var DASH = '—';
  var DOT = '·';
  var MINUS = '−';

  // Pass through aria-*, data-* and a few safe DOM props.
  function passThrough(p) {
    var o = {};
    Object.keys(p).forEach(function (k) {
      if (k.indexOf('aria-') === 0 || k.indexOf('data-') === 0) o[k] = p[k];
    });
    ['id', 'title', 'tabIndex', 'role', 'onFocus', 'onBlur', 'onKeyDown', 'onMouseEnter', 'onMouseLeave', 'form', 'name', 'autoFocus'].forEach(function (k) {
      if (p[k] !== undefined) o[k] = p[k];
    });
    return o;
  }

  // Format a value with a function or a named MC.fmt preset.
  function fmtValue(v, format, row) {
    if (typeof format === 'function') return format(v, row);
    var F = MC.fmt || {};
    if (v == null || (typeof v === 'number' && !isFinite(v))) return DASH;
    if (typeof v !== 'number') return String(v);
    switch (format) {
      case 'money': return F.money ? F.money(v) : '$' + Math.round(v);
      case 'moneyCompact': case 'money-compact': return F.money ? F.money(v, { compact: true }) : '$' + Math.round(v);
      case 'cents': return F.money ? F.money(v, { cents: true }) : '$' + v.toFixed(2);
      case 'pct': return F.pct ? F.pct(v) : (v * 100).toFixed(1) + '%';
      case 'pct2': return F.pct ? F.pct(v, 2) : (v * 100).toFixed(2) + '%';
      case 'pp': return F.pp ? F.pp(v) : (v * 100).toFixed(1) + ' pp';
      case 'delta': return F.delta ? F.delta(v) : (v * 100).toFixed(1) + '%';
      case 'ratio': return F.ratio ? F.ratio(v) : v.toFixed(1) + '×';
      case 'compact': return F.num ? F.num(v, { compact: true }) : String(Math.round(v));
      case 'int': return F.num ? F.num(Math.round(v)) : String(Math.round(v));
      default: return F.num ? F.num(v) : String(v);
    }
  }
  function agentName(id) {
    var k = String(id || '');
    if (k.indexOf('agent:') === 0) k = k.slice(6);
    if (!k || k === 'user') return 'You';
    if (k === 'sim') return 'the simulator';
    try {
      var d = MC.runtime && typeof MC.runtime.def === 'function' ? MC.runtime.def(k) : null;
      if (d && d.name) return d.name;
    } catch (e) { /* fall through */ }
    return AGENT_NAMES[k] || k;
  }
  var AGENT_NAMES = {
    optimizer: 'Variant Optimizer', sendtime: 'Send-Time Tuner', pacer: 'Budget Pacer', guard: 'Fatigue Guard',
    scout: 'Segment Scout', copy: 'Copy Drafter', analyst: 'Insight Analyst', planner: 'Campaign Planner'
  };
  function IconOf(p) {
    var I = U.Icon;
    if (!p.name || typeof I !== 'function') return null;
    return H()`<${I} name=${p.name} size=${p.size || 16} />`;
  }

  U.cx = cx;
  U.fmtValue = fmtValue;
  U.agentName = agentName;

  /* ---------------- hooks ---------------- */
  // Width of the referenced element in CSS px (0 before the first measure).
  MC.hooks.useWidth = function useWidth(ref) {
    var React = R();
    var st = React.useState(0), w = st[0], setW = st[1];
    var bound = React.useRef({ el: null, off: null });
    // Re-binds whenever the referenced element changes (conditional mounts), without deps churn.
    React.useLayoutEffect(function () {
      var el = ref && ref.current;
      var b = bound.current;
      if (el === b.el) return;
      if (b.off) { b.off(); b.off = null; }
      b.el = el;
      if (!el) return;
      function measure(width) {
        var nw = Math.max(0, Math.floor(width));
        setW(function (prev) { return prev === nw ? prev : nw; });
      }
      measure(el.getBoundingClientRect().width);
      if (typeof window.ResizeObserver === 'function') {
        var ro = new window.ResizeObserver(function (entries) {
          if (entries && entries[0]) measure(entries[0].contentRect.width);
        });
        ro.observe(el);
        b.off = function () { ro.disconnect(); };
      } else {
        var onResize = function () { measure(el.getBoundingClientRect().width); };
        window.addEventListener('resize', onResize);
        b.off = function () { window.removeEventListener('resize', onResize); };
      }
    });
    React.useEffect(function () {
      return function () { var b = bound.current; if (b.off) b.off(); b.off = null; b.el = null; };
    }, []);
    return w;
  };

  function mq(q) {
    try { return window.matchMedia ? window.matchMedia(q) : null; } catch (e) { return null; }
  }
  function useMedia(q) {
    var React = R();
    var st = React.useState(function () { var m = mq(q); return !!(m && m.matches); });
    React.useEffect(function () {
      var m = mq(q);
      if (!m) return undefined;
      function on() { st[1](!!m.matches); }
      on();
      if (m.addEventListener) m.addEventListener('change', on); else if (m.addListener) m.addListener(on);
      return function () { if (m.removeEventListener) m.removeEventListener('change', on); else if (m.removeListener) m.removeListener(on); };
    }, [q]);
    return st[0];
  }
  MC.hooks.useMedia = useMedia;
  MC.hooks.useReducedMotion = function useReducedMotion() { return useMedia('(prefers-reduced-motion: reduce)'); };

  /* ---------------- Button / IconButton ---------------- */
  U.Button = function Button(p) {
    var html = H();
    var kind = p.kind || 'secondary';
    var size = p.size || 'md';
    var extra = passThrough(p);
    return html`<button ...${extra} type=${p.type || 'button'}
        className=${cx('k-btn', 'k-btn--' + kind, 'k-btn--' + size, p.block && 'k-btn--block', p.className)}
        onClick=${p.onClick} disabled=${!!p.disabled || !!p.busy} aria-busy=${p.busy ? 'true' : null}>
      ${p.icon ? html`<${IconOf} name=${p.icon} size=${size === 'sm' ? 14 : 16} />` : null}
      ${p.children != null && p.children !== false ? html`<span className="k-btn-label">${p.children}</span>` : null}
      ${p.iconRight ? html`<${IconOf} name=${p.iconRight} size=${size === 'sm' ? 14 : 16} />` : null}
    </button>`;
  };

  U.IconButton = function IconButton(p) {
    var html = H();
    var extra = passThrough(p);
    return html`<button ...${extra} type="button" className=${cx('k-iconbtn', p.size === 'sm' && 'k-iconbtn--sm', p.kind && 'k-iconbtn--' + p.kind, p.pressed && 'is-pressed', p.className)}
        aria-label=${p.label} title=${p.title || p.label} onClick=${p.onClick} disabled=${!!p.disabled}
        aria-pressed=${p.pressed == null ? null : (p.pressed ? 'true' : 'false')}>
      <${IconOf} name=${p.icon} size=${p.size === 'sm' ? 16 : 18} />
      ${fin(p.badge) && p.badge > 0 ? html`<span className="k-iconbtn-badge num" aria-hidden="true">${p.badge > 99 ? '99+' : p.badge}</span>` : null}
    </button>`;
  };

  /* ---------------- Segmented (radiogroup, arrow keys) ---------------- */
  U.Segmented = function Segmented(p) {
    var html = H();
    var opts = p.options || [];
    var id = p.id || 'seg';
    var idx = -1;
    opts.forEach(function (o, i) { if (o.value === p.value) idx = i; });
    function optId(o) { return id + '-' + String(o.value).replace(/[^a-zA-Z0-9_-]/g, '_'); }
    function onKey(e, i) {
      var n = opts.length, j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j < 0) return;
      e.preventDefault();
      var guard = 0;
      while (opts[j] && opts[j].disabled && guard++ < n) j = (j + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? n - 1 : 1)) % n;
      if (!opts[j] || opts[j].disabled) return;
      if (p.onChange) p.onChange(opts[j].value);
      var el = document.getElementById(optId(opts[j]));
      if (el) el.focus();
    }
    return html`<div className=${cx('k-seg', p.size === 'sm' && 'k-seg--sm', p.block && 'k-seg--block', p.className)} role="radiogroup" id=${id}
        aria-label=${p.label} aria-disabled=${p.disabled ? 'true' : null}>
      ${opts.map(function (o, i) {
        var on = i === idx;
        var focusable = on || (idx < 0 && i === 0);
        return html`<button key=${String(o.value)} type="button" role="radio" id=${optId(o)}
            className=${cx('k-seg-opt', on && 'is-on')} aria-checked=${on ? 'true' : 'false'} tabIndex=${focusable ? 0 : -1}
            disabled=${!!(p.disabled || o.disabled)} title=${o.title || null} aria-label=${o.ariaLabel || null}
            onClick=${function () { if (!on && p.onChange) p.onChange(o.value); }} onKeyDown=${function (e) { onKey(e, i); }}>
          ${o.icon ? html`<${IconOf} name=${o.icon} size=${14} />` : null}
          ${o.iconOnly ? null : html`<span>${o.label}</span>`}
        </button>`;
      })}
    </div>`;
  };

  /* ---------------- Field + inputs ---------------- */
  U.Field = function Field(p) {
    var html = H(), React = R();
    var hintId = p.hint ? p.id + '-hint' : null;
    var errId = p.error ? p.id + '-error' : null;
    var desc = [hintId, errId].filter(Boolean).join(' ') || null;
    var kids = p.children;
    if (desc && React.isValidElement(kids) && kids.props && !kids.props['aria-describedby']) {
      kids = React.cloneElement(kids, { 'aria-describedby': desc, 'aria-invalid': p.error ? 'true' : kids.props['aria-invalid'] });
    }
    return html`<div className=${cx('k-field', p.inline && 'k-field--inline', p.error && 'is-invalid', p.className)}>
      <div className="k-field-head">
        <label className="k-label" htmlFor=${p.id}>${p.label}${p.required ? html`<span className="k-req" aria-hidden="true"> *</span>` : null}</label>
        ${p.aside ? html`<span className="k-field-aside">${p.aside}</span>` : null}
      </div>
      ${kids}
      ${p.hint ? html`<p className="k-hint" id=${hintId}>${p.hint}</p>` : null}
      ${p.error ? html`<p className="k-error" id=${errId} role="alert">${p.error}</p>` : null}
    </div>`;
  };

  function Counter(p) {
    var html = H();
    var n = String(p.value == null ? '' : p.value).length;
    var over = fin(p.max) && n > p.max;
    return html`<span className=${cx('k-counter', 'num', over && 'is-over')} aria-live="off">${n}${fin(p.max) ? '/' + p.max : ''}</span>`;
  }
  function inputProps(p) {
    var o = passThrough(p);
    o.id = p.id;
    if (p.placeholder != null) o.placeholder = p.placeholder;
    if (p.disabled) o.disabled = true;
    if (p.readOnly) o.readOnly = true;
    if (p.required) o.required = true;
    if (p.autoComplete) o.autoComplete = p.autoComplete;
    if (p.inputMode) o.inputMode = p.inputMode;
    if (p.label && !o['aria-label']) o['aria-label'] = p.label;
    if (p.invalid) o['aria-invalid'] = 'true';
    return o;
  }
  // value/onChange(value, event); without `value` the input is uncontrolled (defaultValue).
  U.TextInput = function TextInput(p) {
    var html = H();
    var o = inputProps(p);
    if (p.value !== undefined) o.value = p.value == null ? '' : p.value; else if (p.defaultValue !== undefined) o.defaultValue = p.defaultValue;
    if (p.maxLength != null && !p.softLimit) o.maxLength = p.maxLength;
    var input = html`<input ...${o} type=${p.type || 'text'} className=${cx('k-input', p.size === 'sm' && 'k-input--sm', p.className)}
      onChange=${function (e) { if (p.onChange) p.onChange(e.target.value, e); }} onBlur=${p.onBlur} onKeyDown=${p.onKeyDown} />`;
    if (!p.counter && !p.prefix && !p.suffix) return input;
    return html`<div className=${cx('k-input-wrap', p.prefix && 'has-prefix', p.suffix && 'has-suffix')}>
      ${p.prefix ? html`<span className="k-affix" aria-hidden="true">${p.prefix}</span>` : null}
      ${input}
      ${p.suffix ? html`<span className="k-affix" aria-hidden="true">${p.suffix}</span>` : null}
      ${p.counter ? html`<${Counter} value=${p.value !== undefined ? p.value : ''} max=${p.maxLength} />` : null}
    </div>`;
  };
  U.TextArea = function TextArea(p) {
    var html = H();
    var o = inputProps(p);
    if (p.value !== undefined) o.value = p.value == null ? '' : p.value; else if (p.defaultValue !== undefined) o.defaultValue = p.defaultValue;
    if (p.maxLength != null && !p.softLimit) o.maxLength = p.maxLength;
    return html`<div className="k-textarea-wrap">
      <textarea ...${o} rows=${p.rows || 4} className=${cx('k-input', 'k-textarea', p.className)}
        onChange=${function (e) { if (p.onChange) p.onChange(e.target.value, e); }} onBlur=${p.onBlur}></textarea>
      ${p.counter ? html`<${Counter} value=${p.value !== undefined ? p.value : ''} max=${p.maxLength} />` : null}
    </div>`;
  };
  // Keeps the typed text locally while focused; reports numbers (or null when empty/invalid).
  U.NumberInput = function NumberInput(p) {
    var html = H(), React = R();
    var focused = React.useRef(false);
    var st = React.useState(p.value == null || !fin(Number(p.value)) ? '' : String(p.value));
    var text = st[0], setText = st[1];
    React.useEffect(function () {
      if (focused.current) return;
      var next = p.value == null || !fin(Number(p.value)) ? '' : String(p.value);
      setText(function (t) { return Number(t) === Number(next) && t !== '' ? t : next; });
    }, [p.value]);
    function clamp(n) {
      if (fin(p.min) && n < p.min) n = p.min;
      if (fin(p.max) && n > p.max) n = p.max;
      return n;
    }
    function onChange(e) {
      var t = e.target.value;
      setText(t);
      if (!p.onChange) return;
      if (t.trim() === '') { p.onChange(null, e); return; }
      var n = Number(t);
      if (fin(n)) p.onChange(n, e);
    }
    function onBlur(e) {
      focused.current = false;
      var n = Number(text);
      if (text.trim() !== '' && fin(n)) {
        var c2 = clamp(n);
        if (c2 !== n) { setText(String(c2)); if (p.onChange) p.onChange(c2, e); }
      }
      if (p.onBlur) p.onBlur(e);
    }
    var o = inputProps(p);
    var input = html`<input ...${o} type="number" inputMode=${p.inputMode || 'decimal'} className=${cx('k-input', 'k-input--num', 'num', p.size === 'sm' && 'k-input--sm', p.className)}
      value=${text} min=${p.min} max=${p.max} step=${p.step || 'any'}
      onFocus=${function () { focused.current = true; }} onChange=${onChange} onBlur=${onBlur} />`;
    if (!p.prefix && !p.suffix) return input;
    return html`<div className=${cx('k-input-wrap', p.prefix && 'has-prefix', p.suffix && 'has-suffix')}>
      ${p.prefix ? html`<span className="k-affix" aria-hidden="true">${p.prefix}</span>` : null}
      ${input}
      ${p.suffix ? html`<span className="k-affix" aria-hidden="true">${p.suffix}</span>` : null}
    </div>`;
  };
  // options: [{value,label,disabled}] or groups [{label, options:[...]}]; onChange(value, event).
  U.Select = function Select(p) {
    var html = H();
    var o = inputProps(p);
    var opts = p.options || [];
    function opt(x) {
      if (x == null) return null;
      if (typeof x !== 'object') x = { value: x, label: String(x) };
      return html`<option key=${String(x.value)} value=${x.value} disabled=${!!x.disabled}>${x.label}</option>`;
    }
    return html`<span className=${cx('k-select-wrap', p.size === 'sm' && 'k-select-wrap--sm', p.className)}>
      <select ...${o} className="k-select" value=${p.value == null ? '' : p.value}
        onChange=${function (e) { if (p.onChange) p.onChange(e.target.value, e); }} onBlur=${p.onBlur}>
        ${p.placeholder ? html`<option value="" disabled=${!p.allowEmpty}>${p.placeholder}</option>` : null}
        ${opts.map(function (x, i) {
          if (x && x.options) return html`<optgroup key=${'g' + i} label=${x.label}>${x.options.map(opt)}</optgroup>`;
          return opt(x);
        })}
      </select>
      <span className="k-select-caret" aria-hidden="true"><${IconOf} name="chevron-down" size=${14} /></span>
    </span>`;
  };
  // onChange(number, event). Shows the formatted value beside the track.
  U.Slider = function Slider(p) {
    var html = H();
    var o = inputProps(p);
    var v = fin(Number(p.value)) ? Number(p.value) : (fin(p.min) ? p.min : 0);
    var shown = p.format ? fmtValue(v, p.format) : String(v);
    o['aria-valuetext'] = shown;
    return html`<div className=${cx('k-slider', p.className)}>
      <input ...${o} type="range" className="k-range" min=${fin(p.min) ? p.min : 0} max=${fin(p.max) ? p.max : 100} step=${p.step || 1} value=${v}
        onChange=${function (e) { if (p.onChange) p.onChange(Number(e.target.value), e); }} onBlur=${p.onBlur} />
      ${p.hideValue ? null : html`<output className="k-slider-out num" htmlFor=${p.id}>${shown}</output>`}
    </div>`;
  };
  // onChange(bool, event)
  U.Checkbox = function Checkbox(p) {
    var html = H();
    var o = passThrough(p);
    delete o.title;
    return html`<label className=${cx('k-check', p.disabled && 'is-disabled', p.className)} htmlFor=${p.id} title=${p.title}>
      <input ...${o} type="checkbox" id=${p.id} className="k-check-input" checked=${!!p.checked} disabled=${!!p.disabled}
        onChange=${function (e) { if (p.onChange) p.onChange(e.target.checked, e); }} />
      <span className="k-check-box" aria-hidden="true"><${IconOf} name="check" size=${12} /></span>
      <span className="k-check-label">${p.label}${p.hint ? html`<span className="k-hint k-check-hint">${p.hint}</span>` : null}</span>
    </label>`;
  };
  // Toggle chip (aria-pressed). onChange(nextBool, event)
  U.ChipToggle = function ChipToggle(p) {
    var html = H();
    var on = !!p.checked;
    var o = passThrough(p);
    return html`<button ...${o} type="button" className=${cx('k-chip', on && 'is-on', p.tone && 'k-chip--' + p.tone, p.size === 'sm' && 'k-chip--sm', p.className)}
        aria-pressed=${on ? 'true' : 'false'} disabled=${!!p.disabled} onClick=${function (e) { if (p.onChange) p.onChange(!on, e); }}>
      ${p.icon ? html`<${IconOf} name=${p.icon} size=${14} />` : null}
      <span>${p.label != null ? p.label : p.children}</span>
      ${fin(p.count) ? html`<span className="k-chip-count num">${p.count}</span>` : null}
    </button>`;
  };

  /* ---------------- Tabs ---------------- */
  // Tab buttons get ids `${id}-${tab.id}`; pass panelId (string or fn(tabId)) for aria-controls.
  U.Tabs = function Tabs(p) {
    var html = H();
    var tabs = p.tabs || [];
    var id = p.id || 'tabs';
    function panelOf(t) {
      if (typeof p.panelId === 'function') return p.panelId(t.id);
      if (typeof p.panelId === 'string') return p.panelId;
      return null;
    }
    function onKey(e, i) {
      var n = tabs.length, j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j < 0) return;
      e.preventDefault();
      if (p.onChange) p.onChange(tabs[j].id);
      var el = document.getElementById(id + '-' + tabs[j].id);
      if (el) el.focus();
    }
    var has = tabs.some(function (t) { return t.id === p.value; });
    return html`<div className=${cx('k-tabs', p.size === 'sm' && 'k-tabs--sm', p.className)} role="tablist" id=${id} aria-label=${p.label || 'Sections'}>
      ${tabs.map(function (t, i) {
        var on = t.id === p.value || (!has && i === 0);
        return html`<button key=${t.id} type="button" role="tab" id=${id + '-' + t.id} className=${cx('k-tab', on && 'is-on')}
            aria-selected=${on ? 'true' : 'false'} aria-controls=${panelOf(t)} tabIndex=${on ? 0 : -1}
            onClick=${function () { if (p.onChange && t.id !== p.value) p.onChange(t.id); }} onKeyDown=${function (e) { onKey(e, i); }}>
          ${t.icon ? html`<${IconOf} name=${t.icon} size=${14} />` : null}
          <span>${t.label}</span>
          ${fin(t.count) ? html`<span className=${cx('k-tab-count', 'num', t.countTone && 'k-tab-count--' + t.countTone)}>${t.count}</span>` : null}
        </button>`;
      })}
    </div>`;
  };

  /* ---------------- Badge / Pill / StatusPill / StatusDot ---------------- */
  U.Badge = function Badge(p) {
    var html = H();
    return html`<span className=${cx('k-badge', 'num', 'k-tone--' + (p.tone || 'neutral'), p.className)} title=${p.title} aria-label=${p['aria-label']}>${p.children != null ? p.children : p.count}</span>`;
  };
  U.Pill = function Pill(p) {
    var html = H();
    return html`<span className=${cx('k-pill', 'k-tone--' + (p.tone || 'neutral'), p.size === 'sm' && 'k-pill--sm', p.className)} title=${p.title}>
      ${p.icon ? html`<${IconOf} name=${p.icon} size=${12} />` : null}${p.children}</span>`;
  };
  var STATUS = {
    draft: { label: 'Draft', tone: 'neutral' }, scheduled: { label: 'Scheduled', tone: 'accent' },
    live: { label: 'Live', tone: 'good' }, paused: { label: 'Paused', tone: 'warn' }, completed: { label: 'Completed', tone: 'neutral' },
    retired: { label: 'Retired', tone: 'neutral' }, pending: { label: 'Needs you', tone: 'signal' }, applied: { label: 'Applied', tone: 'good' },
    auto: { label: 'Applied by agent', tone: 'agent' }, rejected: { label: 'Dismissed', tone: 'neutral' }, expired: { label: 'Expired', tone: 'neutral' },
    superseded: { label: 'Superseded', tone: 'neutral' }, undone: { label: 'Undone', tone: 'neutral' }, stale: { label: 'No longer applies', tone: 'warn' },
    on: { label: 'On track', tone: 'good' }, risk: { label: 'At risk', tone: 'warn' }, off: { label: 'Off track', tone: 'crit' }
  };
  U.StatusPill = function StatusPill(p) {
    var html = H();
    var s = STATUS[p.status] || {};
    var tone = p.tone || s.tone || 'neutral';
    return html`<span className=${cx('k-pill', 'k-status', 'k-tone--' + tone, p.className)} title=${p.title}>
      <span className="k-status-dot" aria-hidden="true"></span>${p.children != null ? p.children : (s.label || p.status)}</span>`;
  };
  var DOT_LABEL = { running: 'Running', paused: 'Paused', off: 'Off', queued: 'Queued run' };
  U.StatusDot = function StatusDot(p) {
    var html = H();
    var state = DOT_LABEL[p.state] ? p.state : 'off';
    var label = p.label === undefined ? DOT_LABEL[state] : p.label;
    return html`<span className=${cx('k-dot', 'is-' + state, p.pulse && 'is-pulse', p.className)}
        role=${label ? 'img' : null} aria-label=${label || null} aria-hidden=${label ? null : 'true'} title=${label || null}></span>`;
  };

  /* ---------------- Panel / KPI / Meter ---------------- */
  U.Panel = function Panel(p) {
    var html = H();
    var tid = p.id ? p.id + '-title' : null;
    var Tag = 'h' + (p.level || 2);
    return html`<section id=${p.id} className=${cx('k-panel', p.dense && 'k-panel--dense', p.className)} aria-labelledby=${p.title ? tid : null}>
      ${p.title || p.actions ? html`<header className="k-panel-head">
        <div className="k-panel-titles">
          ${p.title ? html`<${Tag} id=${tid} className="k-panel-title">${p.title}${fin(p.count) ? html` <span className="k-panel-count num">${p.count}</span>` : null}<//>` : null}
          ${p.sub ? html`<p className="k-panel-sub">${p.sub}</p>` : null}
        </div>
        ${p.actions ? html`<div className="k-panel-actions">${p.actions}</div>` : null}
      </header>` : null}
      <div className="k-panel-body">${p.children}</div>
      ${p.footer ? html`<footer className="k-panel-foot">${p.footer}</footer>` : null}
    </section>`;
  };

  U.Meter = function Meter(p) {
    var html = H();
    var max = fin(p.max) && p.max > 0 ? p.max : 1;
    var v = fin(p.value) ? Math.max(0, p.value) : 0;
    var pct = Math.min(100, v / max * 100);
    var ghost = fin(p.ghost) ? Math.min(100, Math.max(0, p.ghost) / max * 100) : null;
    var goal = fin(p.goal) ? Math.min(100, Math.max(0, p.goal) / max * 100) : null;
    var label = p.label || ('' + Math.round(pct) + '%');
    return html`<div className=${cx('k-meter', 'k-tone--' + (p.tone || 'accent'), p.size === 'lg' && 'k-meter--lg', p.className)}
        role="progressbar" aria-label=${label} aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${v} aria-valuetext=${p.valueText || null}>
      ${ghost != null && ghost > pct ? html`<span className="k-meter-ghost" style=${{ width: ghost + '%' }}></span>` : null}
      <span className="k-meter-fill" style=${{ width: pct + '%' }}></span>
      ${goal != null ? html`<span className="k-meter-goal" style=${{ left: goal + '%' }} aria-hidden="true"></span>` : null}
    </div>`;
  };
  U.ProgressBar = function ProgressBar(p) { return U.Meter(p); };

  var KPI_STATUS = { on: 'on', good: 'on', risk: 'risk', warn: 'risk', off: 'off', crit: 'off' };
  // {label, value, format, goal, goalLabel, forecast, delta, deltaFormat, invert, spark, status, onClick, id, note}
  U.KPI = function KPI(p) {
    var html = H();
    var Spark = MC.charts && MC.charts.Sparkline;
    var st = KPI_STATUS[p.status] || null;
    var valueText = p.value == null ? DASH : fmtValue(p.value, p.format);
    var inner = html`
      <span className="k-kpi-label">${p.label}</span>
      <span className="k-kpi-value num">${valueText}</span>
      ${p.goal != null ? html`<span className="k-kpi-goal num">${p.goalLabel || ('of ' + fmtValue(p.goal, p.format) + ' goal')}</span>` : (p.note ? html`<span className="k-kpi-goal">${p.note}</span>` : null)}
      ${fin(p.goal) && p.goal > 0 && fin(p.value) ? html`<${U.Meter} value=${p.value} max=${Math.max(p.goal, p.forecast || 0, p.value) * 1.1}
          goal=${p.goal} ghost=${p.forecast} tone=${st === 'off' ? 'crit' : st === 'risk' ? 'warn' : 'accent'}
          label=${p.label + ' progress toward goal'} />` : null}
      <span className="k-kpi-foot">
        ${fin(p.delta) ? html`<${U.Delta} value=${p.delta} format=${p.deltaFormat || 'delta'} invert=${p.invert} suffix=${p.deltaSuffix || ' vs prior 7 days'} />` : null}
        ${st ? html`<${U.StatusPill} status=${st} />` : null}
      </span>
      ${Spark && p.spark && p.spark.length > 1 ? html`<span className="k-kpi-spark"><${Spark} values=${p.spark} width=${96} height=${24} ariaLabel=${p.label + ', last ' + p.spark.length + ' days'} /></span>` : null}`;
    if (p.onClick) {
      return html`<button type="button" id=${p.id} className=${cx('k-kpi', 'is-clickable', p.className)} onClick=${p.onClick} title=${p.title}>${inner}</button>`;
    }
    return html`<div id=${p.id} className=${cx('k-kpi', p.className)}>${inner}</div>`;
  };

  /* ---------------- Delta / Money / Num ---------------- */
  // {value, format='delta', invert (lower is better), suffix, neutral}
  U.Delta = function Delta(p) {
    var html = H();
    var v = p.value;
    if (!fin(v)) return html`<span className="k-delta is-flat num">${DASH}</span>`;
    var good = p.invert ? v < 0 : v > 0;
    var flat = Math.abs(v) < 1e-9;
    var tone = p.neutral || flat ? 'is-flat' : (good ? 'is-good' : 'is-bad');
    var text = fmtValue(v, p.format || 'delta');
    if (v < 0 && text.charAt(0) === '-') text = MINUS + text.slice(1);
    if (v > 0 && text.charAt(0) !== '+') text = '+' + text;
    return html`<span className=${cx('k-delta', 'num', tone, p.className)}>
      <span aria-hidden="true">${flat ? '' : (v > 0 ? '▲ ' : '▼ ')}</span>${text}${p.suffix ? html`<span className="k-delta-suffix">${p.suffix}</span>` : null}</span>`;
  };
  U.Money = function Money(p) {
    var html = H();
    var F = MC.fmt || {};
    var t = fin(p.value) ? (F.money ? F.money(p.value, { compact: !!p.compact, cents: !!p.cents, sign: !!p.sign }) : '$' + Math.round(p.value)) : DASH;
    return html`<span className=${cx('num', p.className)}>${t}</span>`;
  };
  U.Num = function Num(p) {
    var html = H();
    var F = MC.fmt || {};
    var t = fin(p.value) ? (p.format ? fmtValue(p.value, p.format) : (F.num ? F.num(p.value, { compact: !!p.compact, dp: p.dp }) : String(p.value))) : DASH;
    return html`<span className=${cx('num', p.className)}>${t}</span>`;
  };

  /* ---------------- DataTable ---------------- */
  // {columns:[{key,label,align,format(v,row),render(row),sort:true|fn(a,b),sortValue(row),width,className,headerLabel}],
  //  rows, rowKey (fn|string, default 'id'), onRowClick(row), selectedKey, freezeOrderWhileFocused=true,
  //  pageSize, empty, caption, id, initialSort:{key,dir}, dense, label, rowClassName(row)}
  function keyFn(rowKey) {
    if (typeof rowKey === 'function') return rowKey;
    var k = rowKey || 'id';
    return function (r) { return r == null ? '' : r[k]; };
  }
  function cmpVals(a, b) {
    var an = a == null || (typeof a === 'number' && !isFinite(a));
    var bn = b == null || (typeof b === 'number' && !isFinite(b));
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (Array.isArray(a)) a = a.length;
    if (Array.isArray(b)) b = b.length;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    a = String(a).toLowerCase(); b = String(b).toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  U.DataTable = function DataTable(p) {
    var html = H(), React = R();
    var cols = p.columns || [];
    var rows = p.rows || [];
    var kf = keyFn(p.rowKey);
    var freezeOK = p.freezeOrderWhileFocused !== false;
    var sortSt = React.useState(p.initialSort || null), sort = sortSt[0], setSort = sortSt[1];
    var pageSt = React.useState(0), page = pageSt[0], setPage = pageSt[1];
    var focSt = React.useState(false), focused = focSt[0], setFocused = focSt[1];
    var frozen = React.useRef(null);

    var col = sort ? cols.filter(function (c) { return c.key === sort.key; })[0] : null;
    var sorted = rows;
    if (col) {
      var dir = sort.dir === 'desc' ? -1 : 1;
      var withIdx = rows.map(function (r, i) { return { r: r, i: i }; });
      withIdx.sort(function (A, B) {
        var c;
        if (typeof col.sort === 'function') c = col.sort(A.r, B.r);
        else {
          var av = col.sortValue ? col.sortValue(A.r) : A.r[col.key];
          var bv = col.sortValue ? col.sortValue(B.r) : B.r[col.key];
          var an = av == null || (typeof av === 'number' && !isFinite(av));
          var bn = bv == null || (typeof bv === 'number' && !isFinite(bv));
          if (an !== bn) return an ? 1 : -1;      // empty values always last
          c = cmpVals(av, bv);
        }
        return c !== 0 ? c * dir : A.i - B.i;
      });
      sorted = withIdx.map(function (x) { return x.r; });
    }
    // Order is frozen while the table has focus; values still update in place by key.
    var sig = sort ? sort.key + ':' + sort.dir : '';
    var shown = sorted;
    if (freezeOK && focused && frozen.current && frozen.current.sig === sig) {
      var byKey = {};
      sorted.forEach(function (r) { byKey[kf(r)] = r; });
      var seen = {};
      shown = [];
      frozen.current.keys.forEach(function (k) { if (byKey[k] !== undefined && !seen[k]) { seen[k] = true; shown.push(byKey[k]); } });
      sorted.forEach(function (r) { var k = kf(r); if (!seen[k]) { seen[k] = true; shown.push(r); } });
    }
    frozen.current = { sig: sig, keys: shown.map(kf) };

    var size = fin(p.pageSize) && p.pageSize > 0 ? p.pageSize : 0;
    var pages = size ? Math.max(1, Math.ceil(shown.length / size)) : 1;
    var pg = Math.min(page, pages - 1);
    var visible = size ? shown.slice(pg * size, pg * size + size) : shown;

    function toggleSort(c) {
      setSort(function (s) {
        if (!s || s.key !== c.key) return { key: c.key, dir: c.align === 'right' || c.numeric ? 'desc' : 'asc' };
        return { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' };
      });
      setPage(0);
    }
    function onRowKey(e, r) {
      if (!p.onRowClick) return;
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target !== e.currentTarget) return;   // let inner buttons handle their own keys
        e.preventDefault();
        p.onRowClick(r, e);
      }
    }
    function onRowClick(e, r) {
      if (!p.onRowClick) return;
      var t = e.target;
      while (t && t !== e.currentTarget) {
        var tag = t.tagName;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'LABEL') return;
        t = t.parentNode;
      }
      p.onRowClick(r, e);
    }
    function cell(c, r) {
      if (typeof c.render === 'function') return c.render(r);
      var v = r[c.key];
      if (c.format) return fmtValue(v, c.format, r);
      if (v == null || v === '') return DASH;
      return typeof v === 'number' ? fmtValue(v) : String(v);
    }
    var emptyNode = p.empty == null ? 'Nothing to show yet.' : p.empty;
    return html`<div className=${cx('k-table-wrap', p.className)}
        onFocus=${function () { setFocused(true); }}
        onBlur=${function (e) { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
      <table id=${p.id} className=${cx('k-table', p.dense && 'k-table--dense', p.onRowClick && 'is-interactive')} aria-label=${p.caption ? null : (p.label || null)}>
        ${p.caption ? html`<caption className="k-table-caption">${p.caption}</caption>` : null}
        <thead><tr>
          ${cols.map(function (c) {
            var sortable = !!c.sort;
            var active = sort && sort.key === c.key;
            var ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : (sortable ? 'none' : null);
            return html`<th key=${c.key} scope="col" className=${cx(c.align === 'right' && 'k-al-right', c.align === 'center' && 'k-al-center', c.className)}
                aria-sort=${ariaSort} style=${c.width ? { width: c.width } : null}>
              ${sortable ? html`<button type="button" className=${cx('k-th-sort', active && 'is-active')} onClick=${function () { toggleSort(c); }}>
                <span>${c.label}</span>
                <${IconOf} name=${active ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevron-down'} size=${12} />
              </button>` : (c.headerLabel || c.label)}
            </th>`;
          })}
        </tr></thead>
        <tbody>
          ${visible.length ? visible.map(function (r) {
            var k = kf(r);
            var sel = p.selectedKey != null && k === p.selectedKey;
            return html`<tr key=${k} className=${cx(sel && 'is-selected', p.rowClassName && p.rowClassName(r))}
                tabIndex=${p.onRowClick ? 0 : null} aria-current=${sel ? 'true' : null}
                onClick=${p.onRowClick ? function (e) { onRowClick(e, r); } : null}
                onKeyDown=${p.onRowClick ? function (e) { onRowKey(e, r); } : null}>
              ${cols.map(function (c) {
                return html`<td key=${c.key} className=${cx(c.align === 'right' && 'k-al-right num', c.align === 'center' && 'k-al-center', c.className)}>${cell(c, r)}</td>`;
              })}
            </tr>`;
          }) : html`<tr className="k-table-empty"><td colSpan=${cols.length || 1}>${emptyNode}</td></tr>`}
        </tbody>
      </table>
      ${size && shown.length > size ? html`<div className="k-table-pager">
        <span className="num">${(pg * size + 1) + '–' + Math.min(shown.length, pg * size + size) + ' of ' + fmtValue(shown.length, 'int')}</span>
        <${U.Button} size="sm" kind="secondary" disabled=${pg <= 0} onClick=${function () { setPage(pg - 1); }} id=${p.id ? p.id + '-prev' : null}>Previous<//>
        <${U.Button} size="sm" kind="secondary" disabled=${pg >= pages - 1} onClick=${function () { setPage(pg + 1); }} id=${p.id ? p.id + '-next' : null}>Next<//>
      </div>` : null}
    </div>`;
  };

  /* ---------------- EmptyState / Skeleton ---------------- */
  U.EmptyState = function EmptyState(p) {
    var html = H();
    return html`<div className=${cx('k-empty', p.compact && 'k-empty--compact', p.className)}>
      ${p.icon ? html`<span className="k-empty-icon" aria-hidden="true"><${IconOf} name=${p.icon} size=${22} /></span>` : null}
      ${p.title ? html`<p className="k-empty-title">${p.title}</p>` : null}
      ${p.body ? html`<p className="k-empty-body">${p.body}</p>` : null}
      ${p.action ? html`<div className="k-empty-action">${p.action}</div>` : null}
    </div>`;
  };
  U.Skeleton = function Skeleton(p) {
    var html = H();
    var n = fin(p.lines) && p.lines > 0 ? p.lines : 1;
    var items = [];
    for (var i = 0; i < n; i++) {
      var w = p.w != null ? p.w : (n > 1 && i === n - 1 ? '60%' : '100%');
      items.push(html`<span key=${i} className="k-skel" style=${{ width: typeof w === 'number' ? w + 'px' : w, height: (p.h || 12) + 'px', borderRadius: p.radius != null ? p.radius : null }}></span>`);
    }
    return html`<span className=${cx('k-skel-group', p.className)} aria-hidden="true">${items}</span>`;
  };

  /* ---------------- overlays: Drawer / Sheet / Popover / Tooltip ---------------- */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function focusables(root) {
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }
  function portal(node) {
    var RD = window.ReactDOM;
    if (RD && typeof RD.createPortal === 'function' && document.body) return RD.createPortal(node, document.body);
    return node;
  }
  var openLayers = 0;
  function lockScroll(on) {
    openLayers = Math.max(0, openLayers + (on ? 1 : -1));
    try { document.documentElement.classList.toggle('k-lock', openLayers > 0); } catch (e) { /* no DOM */ }
  }

  // {open, onClose, title, width=440, children, id, footer, side:'right'|'left'|'bottom', className, initialFocus (selector)}
  U.Drawer = function Drawer(p) {
    var html = H(), React = R();
    var panel = React.useRef(null);
    var onCloseRef = React.useRef(p.onClose);
    onCloseRef.current = p.onClose;
    var open = !!p.open;
    var id = p.id || 'k-drawer';
    React.useEffect(function () {
      if (!open) return undefined;
      var prev = document.activeElement;
      lockScroll(true);
      var raf = window.requestAnimationFrame(function () {
        var el = panel.current;
        if (!el) return;
        var first = p.initialFocus ? el.querySelector(p.initialFocus) : null;
        if (!first) { var list = focusables(el.querySelector('.k-drawer-body')); first = list[0] || el.querySelector('.k-drawer-close'); }
        if (first && first.focus) first.focus(); else el.focus();
      });
      function onKey(e) {
        if (!panel.current) return;
        if (e.key === 'Escape') {
          if (e.defaultPrevented) return;
          e.preventDefault();
          if (onCloseRef.current) onCloseRef.current();
          return;
        }
        if (e.key !== 'Tab') return;
        var list = focusables(panel.current);
        if (!list.length) { e.preventDefault(); panel.current.focus(); return; }
        var a = list[0], z = list[list.length - 1];
        if (!panel.current.contains(document.activeElement)) { e.preventDefault(); a.focus(); return; }
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
      document.addEventListener('keydown', onKey);
      return function () {
        window.cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        lockScroll(false);
        var back = p.returnFocusRef && p.returnFocusRef.current ? p.returnFocusRef.current : prev;
        if (back && back.focus && document.contains(back)) { try { back.focus(); } catch (e) { /* gone */ } }
      };
    }, [open]);
    if (!open) return null;
    var side = p.side || 'right';
    var style = side === 'bottom' ? null : { width: 'min(100vw, ' + (p.width || 440) + 'px)' };
    return portal(html`<div className=${cx('k-layer', 'k-layer--' + side)}>
      <div className="k-scrim" onClick=${function () { if (onCloseRef.current) onCloseRef.current(); }} aria-hidden="true"></div>
      <div ref=${panel} id=${id} className=${cx('k-drawer', 'k-drawer--' + side, p.className)} role="dialog" aria-modal="true"
          aria-labelledby=${id + '-title'} tabIndex="-1" style=${style}>
        <header className="k-drawer-head">
          <h2 id=${id + '-title'} className="k-drawer-title">${p.title}</h2>
          ${p.headerExtra || null}
          <button type="button" className="k-iconbtn k-drawer-close" aria-label=${'Close ' + (typeof p.title === 'string' ? p.title : 'panel')}
            onClick=${function () { if (onCloseRef.current) onCloseRef.current(); }}><${IconOf} name="x" size=${18} /></button>
        </header>
        <div className="k-drawer-body">${p.children}</div>
        ${p.footer ? html`<footer className="k-drawer-foot">${p.footer}</footer>` : null}
      </div>
    </div>`);
  };
  U.Sheet = function Sheet(p) {
    var html = H();
    return html`<${U.Drawer} ...${p} side=${p.side || 'bottom'} className=${cx('k-sheet', p.className)} />`;
  };

  // {anchorRef, open, onClose, children, label, id, placement:'bottom-start'|'bottom-end'|'top-start', width}
  U.Popover = function Popover(p) {
    var html = H(), React = R();
    var box = React.useRef(null);
    var posSt = React.useState(null), pos = posSt[0], setPos = posSt[1];
    var onCloseRef = React.useRef(p.onClose);
    onCloseRef.current = p.onClose;
    var open = !!p.open;
    React.useLayoutEffect(function () {
      if (!open) { setPos(null); return undefined; }
      function place() {
        var a = p.anchorRef && p.anchorRef.current;
        var el = box.current;
        if (!a) return;
        var r = a.getBoundingClientRect();
        var vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
        var w = el ? el.offsetWidth : (p.width || 320);
        var hgt = el ? el.offsetHeight : 200;
        var pl = p.placement || 'bottom-start';
        var left = pl.indexOf('end') >= 0 ? r.right - w : r.left;
        left = Math.max(8, Math.min(left, vw - w - 8));
        var top = pl.indexOf('top') === 0 ? r.top - hgt - 6 : r.bottom + 6;
        if (top + hgt > vh - 8 && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
        top = Math.max(8, top);
        setPos(function (old) { return old && old.left === left && old.top === top ? old : { left: left, top: top }; });
      }
      place();
      var raf = window.requestAnimationFrame(place);
      function onDown(e) {
        var a = p.anchorRef && p.anchorRef.current;
        if (box.current && box.current.contains(e.target)) return;
        if (a && a.contains(e.target)) return;
        if (onCloseRef.current) onCloseRef.current();
      }
      function onKey(e) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        if (onCloseRef.current) onCloseRef.current();
        var a = p.anchorRef && p.anchorRef.current;
        if (a && a.focus) a.focus();
      }
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey, true);
      return function () {
        window.cancelAnimationFrame(raf);
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', place, true);
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey, true);
      };
    }, [open]);
    if (!open) return null;
    var style = { position: 'fixed', left: pos ? pos.left : -9999, top: pos ? pos.top : -9999, width: p.width ? 'min(' + p.width + 'px, calc(100vw - 16px))' : null };
    return portal(html`<div ref=${box} id=${p.id} className=${cx('k-pop', p.className)} role="dialog" aria-label=${p.label || null} style=${style}>
      ${p.children}
    </div>`);
  };

  var tipSeq = 0;
  U.Tooltip = function Tooltip(p) {
    var html = H(), React = R();
    var idRef = React.useRef(null);
    if (!idRef.current) { tipSeq++; idRef.current = 'k-tip-' + tipSeq; }
    var kid = p.children;
    if (React.isValidElement(kid)) kid = React.cloneElement(kid, { 'aria-describedby': idRef.current });
    return html`<span className=${cx('k-tip-wrap', p.placement === 'bottom' && 'k-tip-wrap--bottom', p.className)}>
      ${kid}
      <span className="k-tip" role="tooltip" id=${idRef.current}>${p.label}</span>
    </span>`;
  };

  /* ---------------- InlineConfirm (replaces confirm()) ---------------- */
  // {message, confirmLabel, cancelLabel, onConfirm, onCancel, tone:'crit'|'accent'|'agent', id, busy}
  U.InlineConfirm = function InlineConfirm(p) {
    var html = H(), React = R();
    var cancelRef = React.useRef(null);
    React.useEffect(function () {
      // Mounted by a click on the control it replaces; keep keyboard focus inside the confirm.
      if (cancelRef.current && p.autoFocus !== false) cancelRef.current.focus();
    }, []);
    function onKey(e) { if (e.key === 'Escape' && p.onCancel) { e.preventDefault(); e.stopPropagation(); p.onCancel(); } }
    return html`<div id=${p.id} className=${cx('k-confirm', 'k-tone--' + (p.tone || 'accent'), p.className)} role="group"
        aria-label=${typeof p.message === 'string' ? p.message : 'Confirm'} onKeyDown=${onKey}>
      <span className="k-confirm-msg">${p.message}</span>
      <span className="k-confirm-actions">
        <${U.Button} kind=${p.tone === 'crit' ? 'danger' : 'primary'} size="sm" onClick=${p.onConfirm} busy=${p.busy}
          id=${p.id ? p.id + '-yes' : null}>${p.confirmLabel || 'Confirm'}<//>
        <button type="button" ref=${cancelRef} className="k-btn k-btn--ghost k-btn--sm" onClick=${p.onCancel}
          id=${p.id ? p.id + '-no' : null}><span className="k-btn-label">${p.cancelLabel || 'Cancel'}</span></button>
      </span>
    </div>`;
  };

  /* ---------------- ConflictChip / NewItemsPill / SampleDataBadge ---------------- */
  U.ConflictChip = function ConflictChip(p) {
    var html = H();
    var who = p.who || agentName(p.agentId);
    return html`<div className=${cx('k-conflict', p.className)} role="group" aria-label="Edit conflict">
      <${IconOf} name="warn" size=${14} />
      <span className="k-conflict-text">${'Updated by ' + who + ' while you were editing'}</span>
      <span className="k-conflict-actions">
        <button type="button" className="k-link" onClick=${p.onTheirs}>Use theirs</button>
        <span aria-hidden="true">${DOT}</span>
        <button type="button" className="k-link" onClick=${p.onMine}>Keep mine</button>
      </span>
    </div>`;
  };
  U.NewItemsPill = function NewItemsPill(p) {
    var html = H();
    var n = fin(p.count) ? p.count : 0;
    if (n <= 0) return null;
    var text = p.label || (n + (n === 1 ? ' new update' : ' new updates'));
    return html`<button type="button" id=${p.id} className=${cx('k-newpill', p.className)} onClick=${p.onClick}>
      <${IconOf} name="arrow-up" size=${14} /><span className="num">${text}</span></button>`;
  };
  U.SampleDataBadge = function SampleDataBadge(p) {
    var html = H();
    return html`<span className=${cx('k-pill', 'k-tone--neutral', 'k-sample', p && p.className)}
      title="Fernway Outfitters is a fictional brand. Every customer, result and agent run is simulated.">Sample data</span>`;
  };

  /* ---------------- ToastHost ---------------- */
  // Reads uiStore.toasts. Toast = {id, text, tone, actions:[{label, kind:'undo'|'view'|'review', proposalId?, route?, focus?}]}
  var TOAST_MS = 6000;
  function runToastAction(t, a) {
    var UI = MC.uiStore || {};
    if (a.kind === 'undo' && a.proposalId) {
      var r = MC.store && MC.store.dispatch ? MC.store.dispatch({ type: 'proposal/undo', payload: { id: a.proposalId } }) : { ok: false, error: 'The simulator is still loading.' };
      if (UI.dismissToast) UI.dismissToast(t.id);
      if (!r || !r.ok) {
        if (UI.addToast) UI.addToast({ text: "Couldn't undo: " + ((r && r.error) || 'the change no longer applies.'), tone: 'crit', actions: [{ label: 'Review', kind: 'review' }] });
      }
      return;
    }
    if (a.kind === 'review') {
      if (UI.set) UI.set({ drawer: 'approvals' });
      if (UI.dismissToast) UI.dismissToast(t.id);
      return;
    }
    if (a.kind === 'view' || a.route) {
      if (MC.nav && MC.nav.go) MC.nav.go(a.route || 'agents', a.focus || null);
      if (UI.dismissToast) UI.dismissToast(t.id);
    }
  }
  function Toast(p) {
    var html = H(), React = R();
    var t = p.toast;
    var hold = React.useState(false), held = hold[0], setHeld = hold[1];
    React.useEffect(function () {
      if (held || t.sticky) return undefined;
      var timer = window.setTimeout(function () { if (MC.uiStore && MC.uiStore.dismissToast) MC.uiStore.dismissToast(t.id); }, TOAST_MS);
      return function () { window.clearTimeout(timer); };
    }, [held, t.id]);
    var icon = t.tone === 'crit' ? 'x-circle' : t.tone === 'good' ? 'check-circle' : t.tone === 'warn' ? 'warn' : t.tone === 'agent' ? 'agents' : 'info';
    return html`<div className=${cx('k-toast', 'k-tone--' + (t.tone || 'neutral'))}
        onMouseEnter=${function () { setHeld(true); }} onMouseLeave=${function () { setHeld(false); }}
        onFocus=${function () { setHeld(true); }} onBlur=${function (e) { if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false); }}>
      <span className="k-toast-icon" aria-hidden="true"><${IconOf} name=${icon} size=${16} /></span>
      <p className="k-toast-text">${t.text}</p>
      <span className="k-toast-actions">
        ${(t.actions || []).map(function (a, i) {
          return html`<button key=${a.kind + i} type="button" className="k-link" onClick=${function () {
            if (typeof p.onAction === 'function' && p.onAction(t, a) === true) return;
            runToastAction(t, a);
          }}>${a.label}</button>`;
        })}
        <button type="button" className="k-iconbtn k-iconbtn--sm k-toast-close" aria-label="Dismiss notification"
          onClick=${function () { if (MC.uiStore && MC.uiStore.dismissToast) MC.uiStore.dismissToast(t.id); }}><${IconOf} name="x" size=${14} /></button>
      </span>
    </div>`;
  }
  function selToasts(s) { return s.toasts; }
  U.ToastHost = function ToastHost(p) {
    var html = H();
    var toasts = (MC.hooks.useUi ? MC.hooks.useUi(selToasts) : null) || [];
    return html`<div className="k-toasts" aria-live="polite" aria-relevant="additions text" role="region" aria-label="Notifications">
      ${toasts.slice(-3).map(function (t) { return html`<${Toast} key=${t.id} toast=${t} onAction=${p && p.onAction} />`; })}
    </div>`;
  };

  /* ======================= MC.xref: how the objects of the product relate (docs/CONSISTENCY.md section 4) =======================
     Pure reads over the world. mission <-> campaign <-> segment <-> message <-> block, and the agent that made or last
     changed each. No numbers live here: counts and money come from MC.metrics. */
  var X = MC.xref = MC.xref || {};
  var NONE = [];
  function wld() { return MC.store && MC.store.getState ? MC.store.getState() : null; }
  X.missions = function (w) { var ms = w && w.missions; return ms && ms.order ? ms.order.map(function (id) { return ms.byId[id]; }).filter(Boolean) : NONE; };
  X.campaignIds = function (w, m) {
    var out = [];
    (m.artifacts || NONE).forEach(function (a) { if (a.kind === 'campaign' && w.campaigns.byId[a.id] && out.indexOf(a.id) < 0) out.push(a.id); });
    if (m.data && m.data.campaignId && w.campaigns.byId[m.data.campaignId] && out.indexOf(m.data.campaignId) < 0) out.push(m.data.campaignId);
    return out;
  };
  X.segmentIds = function (w, m) {
    var out = [];
    function add(id) { if (id && w.segments.byId[id] && out.indexOf(id) < 0) out.push(id); }
    (m.artifacts || NONE).forEach(function (a) { if (a.kind === 'segment') add(a.id); });
    if (m.data && m.data.audience) { add(m.data.audience.segmentId); add(m.data.audience.resolvedId); }
    X.campaignIds(w, m).forEach(function (cid) { add(w.campaigns.byId[cid].segmentId); });
    return out;
  };
  X.messagesOfCampaign = function (w, cid) {
    var by = {}, out = [], vs = MC.catalog && MC.catalog.variantsOf ? MC.catalog.variantsOf(w, cid) : NONE;
    vs.forEach(function (v) {
      if (!v.messageId || v.status === 'retired') return;
      var e = by[v.messageId];
      if (!e) { var msg = MC.content && MC.content.message ? MC.content.message(w, v.messageId) : null; e = by[v.messageId] = { id: v.messageId, name: msg ? msg.name : v.messageId, channels: [] }; out.push(e); }
      if (e.channels.indexOf(v.channel) < 0) e.channels.push(v.channel);
    });
    return out;
  };
  X.campaignsOfMessage = function (w, mid) {
    var out = [];
    Object.keys(w.variants.byId).sort().forEach(function (id) { var v = w.variants.byId[id]; if (v.messageId === mid && v.status !== 'retired' && out.indexOf(v.campaignId) < 0 && w.campaigns.byId[v.campaignId]) out.push(v.campaignId); });
    return out;
  };
  X.missionsOf = function (w, kind, id) {
    var ms = X.missions(w), out = [];
    if (!w || !id) return out;
    if (kind === 'block' && MC.select && MC.select.whereUsed) {
      var wu = MC.select.whereUsed(w, id), ids = (wu.missions || NONE).map(function (m) { return m.id; });
      return ms.filter(function (m) { return ids.indexOf(m.id) >= 0; });
    }
    ms.forEach(function (m) {
      var hit = false;
      if (kind === 'campaign') hit = X.campaignIds(w, m).indexOf(id) >= 0;
      else if (kind === 'segment') hit = X.segmentIds(w, m).indexOf(id) >= 0;
      else if (kind === 'message') hit = X.campaignIds(w, m).some(function (cid) { return X.messagesOfCampaign(w, cid).some(function (x) { return x.id === id; }); });
      else if (kind === 'agent') hit = (m.plan || NONE).some(function (s) { return s.agentId === id; });
      if (hit) out.push(m);
    });
    return out;
  };
  // Who made it (the mission step that produced it, else the stored author) and who last changed it (newest agent action on it).
  X.agentsOf = function (w, kind, id) {
    var made = null, changed = null, tick = null;
    X.missions(w).forEach(function (m) {
      (m.plan || NONE).forEach(function (s) { if (!made && s.artifact && s.artifact.kind === kind && s.artifact.id === id) made = s.agentId; });
    });
    var rec = kind === 'campaign' ? w.campaigns.byId[id] : kind === 'segment' ? w.segments.byId[id]
      : kind === 'block' && MC.content ? MC.content.block(w, id) : kind === 'message' && MC.content ? MC.content.message(w, id) : null;
    function clean(a) { a = String(a || ''); if (a.indexOf('agent:') === 0) a = a.slice(6); return a && a !== 'user' && a !== 'sim' ? a : null; }
    if (!made && rec) made = clean(rec.createdBy || rec.author);
    var feed = w.feed || NONE;
    for (var i = 0; i < feed.length && i < 600; i++) {
      var f = feed[i];
      if (f.kind === 'agent-applied' && f.entity && f.entity.kind === kind && f.entity.id === id) { changed = f.agentId; tick = f.tick; break; }
    }
    if (!changed && rec) { changed = clean(rec.updatedBy); tick = rec.updatedTick; }
    return { made: made, changed: changed, tick: tick };
  };
  // Where a click on an object of this kind should land.
  X.go = function (kind, id) {
    var nav = MC.nav && MC.nav.go; if (!nav) return;
    if (kind === 'mission') nav('missions', id);
    else if (kind === 'campaign') nav('campaigns', { mode: 'detail', id: id, tab: 'overview' });
    else if (kind === 'segment') nav('audiences', { tab: 'segments', segmentId: id });
    else if (kind === 'message') nav('content', { messageId: id, variantId: null, tab: 'compose' });
    else if (kind === 'block') nav('content', { blockId: id, tab: 'library' });
    else if (kind === 'agent') nav('agents', { tab: 'activity', agentId: id });
  };
  X.href = function (kind, id) {
    return kind === 'mission' ? '#missions/' + encodeURIComponent(id) : kind === 'campaign' ? '#campaigns' : kind === 'segment' ? '#audiences'
      : kind === 'agent' ? '#team' : '#content';
  };
  X.missionTitle = function (m) { return m ? (m.goalText || m.title || 'Untitled goal') : ''; };

  // <Xlink kind id>label</Xlink>: a real link that navigates in place.
  U.Xlink = function Xlink(p) {
    var html = H();
    return html`<a href=${X.href(p.kind, p.id)} className=${cx('xlink', p.className)} data-xref=${p.kind + ':' + p.id}
      onClick=${function (e) { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); if (p.onGo) p.onGo(); X.go(p.kind, p.id); }}>${p.children}</a>`;
  };
  /* <Xref kind id /> shows the object's place in the story as one quiet line of links:
     Mission, made / changed by agent, audience, messages. Hides parts that do not apply. */
  U.Xref = function Xref(p) {
    var html = H(), w = MC.hooks.useSelect(function (x) { return x; });
    if (!w || !p.id) return null;
    var kind = p.kind, id = p.id, parts = [];
    var ms = X.missionsOf(w, kind, id), ag = X.agentsOf(w, kind, id);
    var camp = kind === 'campaign' ? w.campaigns.byId[id] : null;
    var seg = camp && camp.segmentId && w.segments.byId[camp.segmentId];
    var msgs = kind === 'campaign' ? X.messagesOfCampaign(w, id) : [];
    var cams = kind === 'message' ? X.campaignsOfMessage(w, id) : [];
    function L(lab, items) { if (items.length) parts.push(html`<span key=${lab} className="xref-part"><span className="xref-k">${lab}</span> ${items}</span>`); }
    function join(arr) { var out = []; arr.forEach(function (x, i) { if (i) out.push(', '); out.push(x); }); return out; }
    L(ms.length === 1 ? 'Mission' : 'Missions', join(ms.slice(0, 3).map(function (m) { return html`<${U.Xlink} key=${m.id} kind="mission" id=${m.id}>${trunc(X.missionTitle(m), 46)}<//>`; })));
    if (ag.made || ag.changed) {
      var items = [];
      if (ag.made) items.push(html`<span key="m">made by <${U.Xlink} kind="agent" id=${ag.made}>${agentName(ag.made)}<//></span>`);
      if (ag.changed && ag.changed !== ag.made) items.push(html`<span key="c">${ag.made ? ', ' : ''}last changed by <${U.Xlink} kind="agent" id=${ag.changed}>${agentName(ag.changed)}<//></span>`);
      parts.push(html`<span key="agent" className="xref-part">${items}</span>`);
    }
    if (seg) L('Audience', [html`<${U.Xlink} key=${seg.id} kind="segment" id=${seg.id}>${seg.name}<//>`]);
    if (msgs.length) L(msgs.length === 1 ? 'Message' : 'Messages', join(msgs.slice(0, 3).map(function (x) { return html`<${U.Xlink} key=${x.id} kind="message" id=${x.id}>${trunc(x.name, 40)}<//>`; })).concat(msgs.length > 3 ? [' +' + (msgs.length - 3)] : []));
    if (cams.length) L(cams.length === 1 ? 'Campaign' : 'Campaigns', join(cams.slice(0, 3).map(function (cid) { return html`<${U.Xlink} key=${cid} kind="campaign" id=${cid}>${w.campaigns.byId[cid].name}<//>`; })));
    if (!parts.length) return null;
    return html`<p className=${cx('xref', p.className)} aria-label="Where this fits">${parts.map(function (x, i) { return html`<span key=${i} className="xref-w">${i ? html`<span className="xref-sep" aria-hidden="true"> ${DOT} </span>` : null}${x}</span>`; })}</p>`;
  };
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
})();
