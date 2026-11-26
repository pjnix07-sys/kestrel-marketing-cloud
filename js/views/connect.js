/* Marketing Cloud - Connect Claude (§12.3). One calm panel for the shell's side sheet.
   MC.connect = { Panel, TopButton, open(), close() }. The user's own key stays in this browser;
   all connection logic lives in MC.ai. Copy comes from MC.ai wherever it exists. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  function html() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function ai() { return MC.ai || null; }
  function cx() { var o = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }
  function kit(n) { var c = MC.ui && MC.ui[n]; return typeof c === 'function' ? c : null; }

  var FALLBACK_STATE = { state: 'off', message: '', remember: true, hasKey: false, modelLabel: '' };

  function useAi() {
    var React = R();
    var s = React.useState(function () { var a = ai(); return a && a.getState ? a.getState() : FALLBACK_STATE; });
    React.useEffect(function () {
      var a = ai();
      if (!a || typeof a.subscribe !== 'function') return undefined;
      var un = a.subscribe(function (g) { s[1](g || (a.getState && a.getState()) || FALLBACK_STATE); });
      s[1](a.getState());
      return function () { if (typeof un === 'function') un(); };
    }, []);
    return s[0];
  }

  function open() { if (MC.uiStore && MC.uiStore.set) MC.uiStore.set({ drawer: 'connect' }); }
  function close() { if (MC.uiStore && MC.uiStore.set) MC.uiStore.set({ drawer: null }); }

  // Module scope on purpose: a component declared inside Panel is a new type on every render,
  // which remounts the anchor and drops keyboard focus.
  function LinkBtn(q) {
    return html`<a className=${cx('k-btn', 'k-btn--' + q.kind, 'k-btn--md', 'k-btn--block')} href=${q.href} target="_blank" rel="noopener noreferrer"
      id="connect-create" onClick=${q.onClick}><span className="k-btn-label">Create a key at Anthropic</span></a>`;
  }

  var TITLE = 'Connect your Anthropic key';

  /* ---------- the panel ---------- */
  function Panel(p) {
    var React = R();
    var g = useAi();
    var A = ai() || {};
    var Button = kit('Button'), Check = kit('Checkbox'), Field = kit('Field');
    var vs = React.useState(false), visited = vs[0], setVisited = vs[1];       // opened the Anthropic tab
    var ms = React.useState(null), localMsg = ms[0], setLocalMsg = ms[1];       // result of the last attempt
    var fs = React.useState(false), manual = fs[0], setManual = fs[1];          // password-field fallback
    var ks = React.useState(''), typed = ks[0], setTyped = ks[1];
    var rs = React.useState(g.remember !== false), remember = rs[0], setRemember = rs[1];
    var busyRef = React.useRef(false);
    var closeTimer = React.useRef(null);

    React.useEffect(function () { return function () { if (closeTimer.current) window.clearTimeout(closeTimer.current); }; }, []);
    // When the tab regains focus after opening the key page, the Paste action becomes the main step.
    React.useEffect(function () {
      if (!visited) return undefined;
      function back() { setVisited('back'); }
      window.addEventListener('focus', back);
      return function () { window.removeEventListener('focus', back); };
    }, [visited]);

    var on = g.state === 'on', connecting = g.state === 'connecting';

    function submit(key) {
      if (busyRef.current || typeof A.connect !== 'function') return;
      busyRef.current = true;
      setLocalMsg(null);
      A.connect(key, { remember: remember }).then(function (r) {
        busyRef.current = false;
        if (r && r.ok) {
          setTyped(''); setManual(false);
          closeTimer.current = window.setTimeout(function () { if (p.onClose) p.onClose(); }, 1400);
        } else {
          setLocalMsg({ tone: 'crit', text: (r && r.error) || "That key didn't work." });
        }
      }, function () { busyRef.current = false; setLocalMsg({ tone: 'crit', text: "Couldn't reach Anthropic. Check your connection and try again." }); });
    }
    function paste() {
      setLocalMsg(null);
      var cb = window.navigator && window.navigator.clipboard;
      if (!cb || typeof cb.readText !== 'function') { setManual(true); return; }
      cb.readText().then(function (t) {
        t = String(t || '').trim();
        if (typeof A.isKeyLike === 'function' && A.isKeyLike(t)) submit(t);
        else { setManual(true); setLocalMsg({ tone: 'warn', text: "What's on your clipboard doesn't look like an Anthropic key. Keys start with sk-ant-." }); }
      }, function () { setManual(true); });
    }
    function submitTyped(e) {
      if (e && e.preventDefault) e.preventDefault();
      var t = typed.trim();
      if (!t) return;
      if (typeof A.isKeyLike === 'function' && !A.isKeyLike(t)) { setLocalMsg({ tone: 'warn', text: "That doesn't look like an Anthropic key. Keys start with sk-ant-." }); return; }
      submit(t);
    }
    function changeRemember(v) { setRemember(!!v); if (on && typeof A.setRemember === 'function') A.setRemember(!!v); }
    function disconnect() { if (typeof A.disconnect === 'function') A.disconnect(); setLocalMsg(null); setVisited(false); setManual(false); }

    function markVisited() { setVisited(function (v) { return v || true; }); }
    var KEY_URL = A.KEY_URL || 'https://platform.claude.com/settings/keys';
    var msgText = localMsg ? localMsg.text : ((g.state === 'invalid' || g.state === 'blocked') ? g.message : '');
    var msgTone = localMsg ? localMsg.tone : 'crit';
    var hasDisabledAi = typeof A.connect !== 'function';
    var pasteIsMain = visited === 'back' && !manual;

    return html`<div className="cx-panel" id="connect-panel">
      <div className="cx-live" role="status" aria-live="polite">
        ${connecting ? 'Checking your key…' : (on ? 'Connected to Claude, ' + (g.modelLabel || '') : '')}
      </div>
      ${on ? html`<div className="cx-on">
        <p className="cx-state"><span className="cx-dot is-on" aria-hidden="true"></span><span>${'Connected · ' + (g.modelLabel || 'Claude')}</span></p>
        <p className="cx-line">Your agents can now reason about each run and write copy, and you can describe audiences and campaigns in plain words.</p>
        ${typeof A.usageLine === 'function' ? html`<p className="cx-usage num">${A.usageLine()}</p>` : null}
        ${Check ? html`<${Check} id="connect-remember" label="Remember on this device" checked=${remember} onChange=${changeRemember} />` : null}
        ${Button ? html`<${Button} kind="secondary" size="md" id="connect-disconnect" onClick=${disconnect}>Disconnect<//>` : null}
      </div>` : html`<div className="cx-off">
        <p className="cx-line">Optional. With a key, agents write and explain their decisions with Claude instead of fixed rules.</p>
        ${connecting ? html`<p className="cx-state"><span className="cx-spin" aria-hidden="true"></span><span>Checking your key…</span></p>` : null}
        ${!connecting ? html`<ol className="cx-steps">
          <li className="cx-step">
            <${LinkBtn} kind=${pasteIsMain ? 'secondary' : 'primary'} href=${KEY_URL} onClick=${markVisited} />
            <p className="cx-hint">Name it Marketing Cloud and pick a 7-day expiry.</p>
          </li>
          <li className="cx-step">
            ${Button ? html`<${Button} kind=${pasteIsMain ? 'primary' : 'secondary'} size="md" block=${true} id="connect-paste" onClick=${paste} disabled=${hasDisabledAi}>Paste key<//>` : null}
            <p className="cx-hint">${visited === 'back' ? 'Copy the new key, then paste it here.' : 'Copy the key, then come back and paste it here.'}</p>
            ${manual ? html`<form className="cx-form" onSubmit=${submitTyped}>
              <label className="cx-label" htmlFor="connect-key">Anthropic key</label>
              <input id="connect-key" className="k-input" type="password" autoComplete="off" spellCheck="false" autoFocus=${true}
                value=${typed} placeholder="sk-ant-…" aria-describedby=${msgText ? 'connect-msg' : null}
                onChange=${function (e) { setTyped(e.target.value); }} />
              ${Button ? html`<${Button} kind="secondary" size="md" type="submit" id="connect-submit" disabled=${!typed.trim()}>Connect<//>` : null}
            </form>` : html`<button type="button" className="cx-link" id="connect-manual" onClick=${function () { setManual(true); }}>Type it in instead</button>`}
          </li>
        </ol>` : null}
        ${msgText ? html`<p id="connect-msg" className=${cx('cx-msg', 'is-' + msgTone)} role="alert">${msgText}</p>` : null}
        ${Check ? html`<${Check} id="connect-remember" label="Remember on this device" checked=${remember} onChange=${changeRemember} />` : null}
      </div>`}
      <p className="cx-policy">${A.DATA_POLICY || 'Only aggregated campaign and audience numbers are sent to Anthropic.'} Your key stays in this browser and is sent only to Anthropic.</p>
      ${!on && typeof A.usageLine === 'function' && A.usage && A.usage().calls ? html`<p className="cx-usage num">${A.usageLine()}</p>` : null}
    </div>`;
  }

  /* ---------- top bar control ---------- */
  function TopButton(p) {
    var g = useAi();
    var on = g.state === 'on', connecting = g.state === 'connecting';
    var label = on ? 'Claude, connected. Open connection settings' : (connecting ? 'Claude, connecting' : 'Connect Claude');
    return html`<button type="button" id="app-connect-btn" className=${cx('cx-top', on && 'is-on')} aria-label=${label} onClick=${open}>
      ${on || connecting ? html`<span className=${cx('cx-dot', on ? 'is-on' : 'is-wait')} aria-hidden="true"></span>` : null}
      <span className="cx-top-label">${on || connecting ? 'Claude' : 'Connect Claude'}</span>
    </button>`;
  }

  MC.connect = { TITLE: TITLE, INITIAL_FOCUS: '#connect-create', Panel: Panel, TopButton: TopButton, open: open, close: close };
})();
