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

  var TITLE = 'Connect Claude';

  function fed() { var a = ai(); return a && a.federation && typeof a.federation.enabled === 'function' && a.federation.enabled() ? a.federation : null; }
  function useFed() {
    var React = R();
    var s = React.useState(function () { var f = fed(); return f ? f.status() : { phase: 'idle', message: '' }; });
    React.useEffect(function () {
      var f = fed();
      if (!f) return undefined;
      var un = f.subscribe(function (x) { s[1](x); });
      s[1](f.status());
      return un;
    }, []);
    return s[0];
  }
  function clockTime(ms) {
    try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }

  // Module scope on purpose (see LinkBtn): native radios, so arrow keys and screen readers work without extra code.
  function Choices(q) {
    return html`<fieldset className="cx-choices">
      <legend className="cx-label">Connect with</legend>
      ${q.items.map(function (it) {
        return html`<label key=${it.id} className=${cx('cx-choice', q.mode === it.id && 'is-sel')} htmlFor=${'connect-mode-' + it.id}>
          <input type="radio" name="cx-mode" id=${'connect-mode-' + it.id} value=${it.id} checked=${q.mode === it.id} onChange=${function () { q.onPick(it.id); }} />
          <span className="cx-choice-t">${it.label}</span>
          <span className="cx-choice-d">${it.hint}</span>
        </label>`;
      })}
    </fieldset>`;
  }

  /* ---------- the panel ---------- */
  function Panel(p) {
    var React = R();
    var g = useAi();
    var fs0 = useFed();
    var A = ai() || {};
    var F = fed();
    var Button = kit('Button'), Check = kit('Checkbox');
    var vs = React.useState(false), visited = vs[0], setVisited = vs[1];       // opened the Anthropic tab
    var ms = React.useState(null), localMsg = ms[0], setLocalMsg = ms[1];       // result of the last attempt
    var fs = React.useState(false), manual = fs[0], setManual = fs[1];          // password-field fallback
    var ks = React.useState(''), typed = ks[0], setTyped = ks[1];
    var ts = React.useState(''), tokenTyped = ts[0], setTokenTyped = ts[1];
    var es = React.useState(''), expiryTyped = es[0], setExpiryTyped = es[1];
    var rn = React.useState(false), renewing = rn[0], setRenewing = rn[1];      // pasting a replacement token while still connected
    var md = React.useState(null), pickedMode = md[0], setMode = md[1];
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

    var on = g.state === 'on' || g.state === 'expiring', expiring = g.state === 'expiring', expired = g.state === 'expired';
    var connecting = g.state === 'connecting';
    var bearer = g.authKind === 'bearer';
    var wasFed = (bearer ? g.source : g.expiredSource) === 'federated';
    var mode = pickedMode || (expired ? (F && wasFed ? 'signin' : 'token') : (F ? 'signin' : 'key'));
    var fedBusy = fs0.phase === 'redirecting' || fs0.phase === 'finishing';

    function done(r, fallback) {
      busyRef.current = false;
      if (r && r.ok) {
        setTyped(''); setManual(false); setTokenTyped(''); setExpiryTyped(''); setRenewing(false);
        closeTimer.current = window.setTimeout(function () { if (p.onClose) p.onClose(); }, 1400);
      } else {
        setLocalMsg({ tone: 'crit', text: (r && r.error) || fallback });
      }
    }
    function failNet() { busyRef.current = false; setLocalMsg({ tone: 'crit', text: "Couldn't reach Anthropic. Check your connection and try again." }); }
    function submit(key) {
      if (busyRef.current || typeof A.connect !== 'function') return;
      busyRef.current = true;
      setLocalMsg(null);
      A.connect(key, { remember: remember }).then(function (r) { done(r, "That key didn't work."); }, failNet);
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
    function submitToken(e) {
      if (e && e.preventDefault) e.preventDefault();
      var t = tokenTyped.trim();
      if (!t || busyRef.current || typeof A.connectToken !== 'function') return;
      if (typeof A.isTokenLike === 'function' && !A.isTokenLike(t)) { setLocalMsg({ tone: 'warn', text: "That doesn't look like a federated access token. They start with sk-ant-oat." }); return; }
      var exp = expiryTyped ? new Date(expiryTyped).getTime() : undefined;
      if (expiryTyped && !isFinite(exp)) { setLocalMsg({ tone: 'warn', text: "That expiry time isn't a valid date." }); return; }
      busyRef.current = true;
      setLocalMsg(null);
      A.connectToken(t, { expiresAt: exp, source: 'pasted' }).then(function (r) { done(r, "That token didn't work."); }, failNet);
    }
    function signIn() { setLocalMsg(null); if (F) F.signIn(); }
    function renew() { setLocalMsg(null); if (F) F.renew(); }
    function changeRemember(v) { setRemember(!!v); if (on && typeof A.setRemember === 'function') A.setRemember(!!v); }
    function disconnect() {
      if (typeof A.disconnect === 'function') A.disconnect();
      if (F) F.clearStatus();
      setLocalMsg(null); setVisited(false); setManual(false); setRenewing(false); setMode(null);
    }
    function pick(id) { setMode(id); setLocalMsg(null); }

    function markVisited() { setVisited(function (v) { return v || true; }); }
    var KEY_URL = A.KEY_URL || 'https://platform.claude.com/settings/keys';
    var fedErr = fs0.phase === 'error' ? fs0.message : '';
    var msgText = localMsg ? localMsg.text : (fedErr || ((g.state === 'invalid' || g.state === 'blocked' || expired) ? g.message : ''));
    var msgTone = localMsg ? localMsg.tone : (expired && !fedErr ? 'warn' : 'crit');
    var hasDisabledAi = typeof A.connect !== 'function';
    var pasteIsMain = visited === 'back' && !manual;
    var checking = connecting ? (mode === 'token' ? 'Checking your token…' : (mode === 'signin' ? 'Finishing sign-in…' : 'Checking your key…')) : '';
    var items = [];
    if (F) items.push({ id: 'signin', label: 'Sign in with ' + F.idpName(), hint: 'Your company sign-in. Nothing to copy.' });
    items.push({ id: 'key', label: 'Anthropic API key', hint: 'Your own key from the Anthropic Console.' });
    items.push({ id: 'token', label: 'Federated access token', hint: 'A short-lived token you paste in.' });

    var tokenForm = html`<form className="cx-form" onSubmit=${submitToken}>
      <p className="cx-hint">A short-lived token from your organisation’s Workload Identity Federation, e.g. from your CI or <code>ant auth print-credentials --access-token</code>.</p>
      <label className="cx-label" htmlFor="connect-token">Federated access token</label>
      <input id="connect-token" className="k-input" type="password" autoComplete="off" spellCheck="false"
        value=${tokenTyped} placeholder="sk-ant-oat01-…" aria-describedby=${msgText ? 'connect-msg' : null}
        onChange=${function (e) { setTokenTyped(e.target.value); }} />
      <label className="cx-label" htmlFor="connect-expiry">Expires at <span className="cx-opt">(optional, if you know it)</span></label>
      <input id="connect-expiry" className="k-input" type="datetime-local" value=${expiryTyped} onChange=${function (e) { setExpiryTyped(e.target.value); }} />
      <p className="cx-hint">Kept in this tab only. It is gone when you close the tab.</p>
      ${Button ? html`<${Button} kind="primary" size="md" block=${true} type="submit" id="connect-token-submit" disabled=${!tokenTyped.trim() || hasDisabledAi}>Connect<//>` : null}
    </form>`;

    var kindLine = bearer
      ? (g.source === 'federated' ? 'Connected with a federated access token from ' + (F ? F.idpName() : 'your company') + '.' : 'Connected with a federated access token.')
      : null;

    return html`<div className="cx-panel" id="connect-panel">
      <div className="cx-live" role="status" aria-live="polite">
        ${checking || (on ? (expiring ? 'Your Claude access token expires soon' : 'Connected to Claude') : '')}
      </div>
      ${on ? html`<div className="cx-on">
        <p className="cx-state"><span className=${cx('cx-dot', expiring ? 'is-wait' : 'is-on')} aria-hidden="true"></span><span>${expiring ? 'Connected, token expiring' : 'Connected to Claude'}</span></p>
        ${kindLine ? html`<p className="cx-line" id="connect-kind">${kindLine}${g.expiresAt ? ' Valid until ' + clockTime(g.expiresAt) + '.' : ''}</p>` : null}
        ${expiring ? html`<div className="cx-renew">
          <p className="cx-msg is-warn" role="alert">This token expires at ${clockTime(g.expiresAt)}. After that the agents go back to rules until you renew it.</p>
          ${bearer && g.source === 'federated' && F
            ? (Button ? html`<${Button} kind="primary" size="md" block=${true} id="connect-renew" onClick=${renew} disabled=${fedBusy}>Renew sign-in<//>` : null)
            : (Button ? html`<${Button} kind="primary" size="md" block=${true} id="connect-renew" onClick=${function () { setRenewing(true); }}>Paste a new token<//>` : null)}
          ${renewing ? tokenForm : null}
        </div>` : null}
        <p className="cx-line">Your agents can now reason about each run and write copy, and you can describe audiences and campaigns in plain words.</p>
        ${typeof A.usageLine === 'function' ? html`<p className="cx-usage num">${A.usageLine()}</p>` : null}
        ${!bearer && Check ? html`<${Check} id="connect-remember" label="Remember on this device" checked=${remember} onChange=${changeRemember} />` : null}
        ${Button ? html`<${Button} kind="secondary" size="md" id="connect-disconnect" onClick=${disconnect}>Disconnect<//>` : null}
      </div>` : html`<div className="cx-off">
        <p className="cx-line">Optional. With Claude connected, agents write and explain their decisions with it instead of fixed rules.</p>
        <${Choices} items=${items} mode=${mode} onPick=${pick} />
        ${connecting || fs0.phase === 'finishing' ? html`<p className="cx-state"><span className="cx-spin" aria-hidden="true"></span><span>${checking || 'Finishing sign-in…'}</span></p>` : null}
        ${!connecting && mode === 'key' ? html`<ol className="cx-steps">
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
        ${!connecting && mode === 'token' ? tokenForm : null}
        ${!connecting && mode === 'signin' && F ? html`<div className="cx-step">
          ${Button ? html`<${Button} kind="primary" size="md" block=${true} id="connect-signin" onClick=${signIn} disabled=${fedBusy || hasDisabledAi}>${'Sign in with ' + F.idpName()}<//>` : null}
          <p className="cx-hint">You leave this page for a moment and come straight back. Agents act as the service account your organisation set up for this app.</p>
        </div>` : null}
        ${msgText ? html`<p id="connect-msg" className=${cx('cx-msg', 'is-' + msgTone)} role="alert">${msgText}</p>` : null}
        ${mode === 'key' && Check ? html`<${Check} id="connect-remember" label="Remember on this device" checked=${remember} onChange=${changeRemember} />` : null}
      </div>`}
      <p className="cx-policy">${A.DATA_POLICY || 'Only aggregated campaign and audience numbers are sent to Anthropic.'} ${(bearer || (!on && mode !== 'key'))
        ? 'Your access token stays in this tab and is sent only to Anthropic.' + (!on && mode === 'signin' ? ' Your company ID token goes only to the relay your organisation runs.' : '')
        : 'Your key stays in this browser and is sent only to Anthropic.'}</p>
      ${!on && typeof A.usageLine === 'function' && A.usage && A.usage().calls ? html`<p className="cx-usage num">${A.usageLine()}</p>` : null}
    </div>`;
  }

  /* ---------- top bar control ---------- */
  function TopButton(p) {
    var g = useAi();
    var expiring = g.state === 'expiring', on = g.state === 'on' || expiring, connecting = g.state === 'connecting', expired = g.state === 'expired';
    var label = expiring ? 'Claude, token expiring. Open connection settings' : (on ? 'Claude, connected. Open connection settings' : (connecting ? 'Claude, connecting' : (expired ? 'Claude, token expired. Open connection settings' : 'Connect Claude')));
    return html`<button type="button" id="app-connect-btn" className=${cx('cx-top', on && 'is-on')} aria-label=${label} onClick=${open}>
      ${on || connecting || expired ? html`<span className=${cx('cx-dot', on && !expiring ? 'is-on' : 'is-wait')} aria-hidden="true"></span>` : null}
      <span className="cx-top-label">${on || connecting || expired ? 'Claude' : 'Connect Claude'}</span>
    </button>`;
  }

  MC.connect = { TITLE: TITLE, INITIAL_FOCUS: '#connect-panel input[name="cx-mode"]:checked', Panel: Panel, TopButton: TopButton, open: open, close: close };
})();
