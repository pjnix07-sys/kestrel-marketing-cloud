/* Marketing Cloud - MC.ai.federation: optional company sign-in (OIDC Authorization Code + PKCE in the browser).
   Off unless MC.CONFIG.federation is set. Flow: discovery -> redirect to the IdP (state, nonce and PKCE verifier kept in sessionStorage)
   -> back on this page with ?code= (URL cleaned at once) -> code exchange at the IdP's token endpoint -> id_token -> POST to the relay
   (the relay holds the Anthropic federation rule ids; api.anthropic.com/v1/oauth/token does not allow browser CORS) -> access token
   -> MC.ai.connectToken(token, {source:'federated'}). The ID token is never stored. The browser does not verify the ID token's
   signature (Anthropic does, against the IdP's JWKS); it checks state, nonce, issuer, audience and expiry. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var AI = MC.ai = MC.ai || {};
  var F = AI.federation = AI.federation || {};

  var PKEY = 'mc.fed.pending';
  var PENDING_MAX_MS = 10 * 60 * 1000;
  var status = { phase: 'idle', message: '', interactive: false };
  var subs = [];

  function report(e) { if (window.console && console.error) console.error(e); }
  function wall() { return Date.now(); }
  function session() { try { return window.sessionStorage || null; } catch (e) { return null; } }
  function cfg() { var c = MC.CONFIG && MC.CONFIG.federation; return c && typeof c === 'object' ? c : null; }
  function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

  F.config = cfg;
  F.REQUIRED = ['issuer', 'clientId', 'redirectUri', 'relayUrl', 'federationRuleId', 'organizationId'];
  F.enabled = function () { var c = cfg(); return !!c && F.REQUIRED.every(function (k) { return typeof c[k] === 'string' && c[k]; }); };
  F.idpName = function () { var c = cfg(); return (c && c.idpName) || 'your company'; };
  F.status = function () { return { phase: status.phase, message: status.message, interactive: status.interactive }; };
  F.subscribe = function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };
  function setStatus(phase, message, interactive) {
    status = { phase: phase, message: message || '', interactive: !!interactive };
    subs.slice().forEach(function (fn) { try { fn(F.status()); } catch (e) { report(e); } });
  }
  F.clearStatus = function () { setStatus('idle', ''); };

  /* ---------------- PKCE (RFC 7636, S256) ---------------- */
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return window.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(nBytes) {
    var a = new Uint8Array(nBytes);
    window.crypto.getRandomValues(a);
    return b64url(a);
  }
  // 48 random bytes -> a 64-character verifier (the RFC allows 43 to 128).
  F.pkce = function () {
    var verifier = randomString(48);
    var data = new window.TextEncoder().encode(verifier);
    return window.crypto.subtle.digest('SHA-256', data).then(function (d) {
      return { verifier: verifier, challenge: b64url(new Uint8Array(d)), method: 'S256' };
    });
  };

  /* ---------------- discovery ---------------- */
  function httpsUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u); }
  F.discover = function () {
    var c = cfg();
    return window.fetch(trimSlash(c.issuer) + '/.well-known/openid-configuration', { credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (res) {
      if (!res.ok) throw new Error('discovery');
      return res.json();
    }).then(function (doc) {
      if (!doc || trimSlash(doc.issuer) !== trimSlash(c.issuer) || !httpsUrl(doc.authorization_endpoint) || !httpsUrl(doc.token_endpoint)) throw new Error('discovery');
      return { authorization_endpoint: doc.authorization_endpoint, token_endpoint: doc.token_endpoint };
    });
  };

  /* ---------------- start: redirect to the IdP ---------------- */
  F.navigate = function (url) { window.location.assign(url); };

  // begin({silent}) -> Promise<{ok, error?}>. silent adds prompt=none: the IdP answers without UI if its session is still valid.
  F.begin = function (opts) {
    opts = opts || {};
    var c = cfg();
    if (!F.enabled()) return Promise.resolve({ ok: false, error: 'not-configured' });
    setStatus('redirecting', 'Going to ' + F.idpName() + '…');
    return F.discover().then(function (doc) {
      return F.pkce().then(function (p) {
        var state = randomString(24), nonce = randomString(24), s = session();
        if (!s) throw new Error('storage');
        s.setItem(PKEY, JSON.stringify({ state: state, nonce: nonce, verifier: p.verifier, silent: !!opts.silent, tokenEndpoint: doc.token_endpoint,
          hash: window.location.hash || '', at: wall() }));
        var q = [['response_type', 'code'], ['client_id', c.clientId], ['redirect_uri', c.redirectUri], ['scope', c.scopes || 'openid'], ['state', state],
          ['nonce', nonce], ['code_challenge', p.challenge], ['code_challenge_method', p.method]];
        if (opts.silent) q.push(['prompt', 'none']);
        var qs = q.map(function (kv) { return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1]); }).join('&');
        F.navigate(doc.authorization_endpoint + (doc.authorization_endpoint.indexOf('?') >= 0 ? '&' : '?') + qs);
        return { ok: true };
      });
    }).catch(function (e) {
      var msg = e && e.message === 'storage' ? 'This browser blocked session storage, so sign-in can’t start.' : 'Couldn’t reach ' + F.idpName() + '. Check your connection and try again.';
      setStatus('error', msg, true);
      return { ok: false, error: e && e.message || 'network' };
    });
  };
  F.signIn = function () { return F.begin({ silent: false }); };
  // Renewal: silent (prompt=none) when the IdP session is alive; the callback asks for an interactive sign-in if it is not.
  F.renew = function () { return F.begin({ silent: true }); };

  /* ---------------- callback ---------------- */
  function parseQuery(search) {
    var out = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (p) {
      if (!p) return;
      var i = p.indexOf('='), k = i < 0 ? p : p.slice(0, i), v = i < 0 ? '' : p.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* skip */ }
    });
    return out;
  }
  function jwtPayload(t) {
    try {
      var p = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var bin = window.atob(p), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new window.TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }
  F.MESSAGES = {
    state: 'Sign-in was rejected: the answer didn’t match this browser session. Start again.',
    nonce: 'Sign-in was rejected: the ID token didn’t match this sign-in. Start again.',
    claims: 'Sign-in was rejected: the ID token wasn’t issued for this app.',
    idp: 'Your company sign-in didn’t complete. Try again.',
    interactive: 'Your company sign-in has ended. Sign in again.',
    denied: 'Sign-in worked, but Anthropic didn’t accept it. Your organisation may not allow this account.',
    busy: 'The sign-in service is busy. Try again in a minute.',
    relay: 'The sign-in relay isn’t answering. Try again, or ask whoever runs it.',
    badresponse: 'The sign-in relay sent an answer this app doesn’t understand.',
    network: 'Couldn’t reach the sign-in service. Check your connection and try again.'
  };

  // exchange(idToken) -> Promise<{ok, token?, expiresIn?, error?}>. Only the assertion is the user's; the relay holds the Anthropic ids.
  F.exchange = function (idToken) {
    var c = cfg();
    var body = { assertion: idToken, federation_rule_id: c.federationRuleId, organization_id: c.organizationId };
    if (c.workspaceId) body.workspace_id = c.workspaceId;
    var ctl = null, timer = null;
    try { ctl = typeof AbortController === 'function' ? new AbortController() : null; } catch (e) { ctl = null; }
    if (ctl) timer = setTimeout(function () { try { ctl.abort(); } catch (e) { /* ignore */ } }, 15000);
    var init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', referrerPolicy: 'no-referrer' };
    if (ctl) init.signal = ctl.signal;
    return Promise.resolve().then(function () { return window.fetch(c.relayUrl, init); }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (txt) {
        if (res.status === 401 || res.status === 403) return { ok: false, error: 'denied' };
        if (res.status === 429) return { ok: false, error: 'busy' };
        if (!(res.status >= 200 && res.status < 300)) return { ok: false, error: 'relay' };
        var j = null;
        try { j = JSON.parse(txt); } catch (e) { j = null; }
        var exp = j && Number(j.expires_in);
        if (!j || !AI.isTokenLike(j.access_token) || !isFinite(exp) || exp <= 0) return { ok: false, error: 'badresponse' };
        return { ok: true, token: j.access_token.trim(), expiresIn: exp };
      });
    }, function () { if (timer) clearTimeout(timer); return { ok: false, error: 'network' }; });
  };

  function fail(code, interactive) {
    setStatus('error', F.MESSAGES[code] || F.MESSAGES.idp, interactive !== false);
    return { ok: false, error: code };
  }

  // handleRedirect(loc?) reads the callback params, cleans the URL at once (synchronously), then finishes the sign-in.
  // Returns null when this page load is not a callback, else Promise<{ok, error?}>.
  F.handleRedirect = function (loc, hist) {
    loc = loc || window.location; hist = hist || window.history;
    if (!loc || !loc.search) return null;
    var q = parseQuery(loc.search);
    if (!(q.state !== undefined && (q.code !== undefined || q.error !== undefined))) return null;
    var s = session(), pending = null;
    try { pending = s && JSON.parse(s.getItem(PKEY) || 'null'); } catch (e) { pending = null; }
    try { if (s) s.removeItem(PKEY); } catch (e) { /* ignore */ }     // one use only
    try { if (hist && hist.replaceState) hist.replaceState(null, '', loc.pathname + ((pending && pending.hash) || '')); } catch (e) { /* ignore */ }
    var c = cfg();
    if (!c || !pending || typeof pending.state !== 'string' || q.state !== pending.state || !(wall() - pending.at < PENDING_MAX_MS)) return Promise.resolve(fail('state'));
    if (q.error !== undefined) {
      var soft = /^(login_required|interaction_required|consent_required|account_selection_required)$/.test(q.error);
      return Promise.resolve(fail(pending.silent && soft ? 'interactive' : 'idp'));
    }
    setStatus('finishing', 'Finishing sign-in…');
    var form = 'grant_type=authorization_code&code=' + encodeURIComponent(q.code) + '&redirect_uri=' + encodeURIComponent(c.redirectUri) +
      '&client_id=' + encodeURIComponent(c.clientId) + '&code_verifier=' + encodeURIComponent(pending.verifier);
    return window.fetch(pending.tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form, credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (res) {
      if (!res.ok) throw new Error('idp');
      return res.json();
    }).then(function (j) {
      var idt = j && j.id_token, p = idt ? jwtPayload(idt) : null;
      if (!p) throw new Error('idp');
      if (p.nonce !== pending.nonce) throw new Error('nonce');
      var aud = Array.isArray(p.aud) ? p.aud : [p.aud];
      if (trimSlash(p.iss) !== trimSlash(c.issuer) || aud.indexOf(c.clientId) < 0 || !(Number(p.exp) * 1000 > wall())) throw new Error('claims');
      return F.exchange(idt);
    }).then(function (r) {
      if (!r.ok) return fail(r.error);
      return AI.connectToken(r.token, { expiresAt: wall() + r.expiresIn * 1000, source: 'federated' }).then(function (cr) {
        if (cr && cr.ok) { setStatus('idle', ''); return { ok: true }; }
        return fail('denied');
      });
    }, function (e) { return fail(e && F.MESSAGES[e.message] ? e.message : (e && e.message === 'idp' ? 'idp' : 'network')); });
  };

  F._test = { randomString: randomString, b64url: b64url, jwtPayload: jwtPayload, parseQuery: parseQuery, PKEY: PKEY };

  try { F.ready = F.handleRedirect(); } catch (e) { report(e); }
})();
