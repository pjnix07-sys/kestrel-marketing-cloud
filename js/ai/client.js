/* Marketing Cloud - MC.ai: the Claude Haiku client (§12.2, §12.3). Key storage, connection state,
   a small concurrency queue, the usage/cost meter and subscribe().
   Raw fetch is deliberate: the binding contract (§2, §10.1) forbids modules/imports and has no build step,
   so the @anthropic-ai/sdk package cannot be loaded. Nothing here touches the world; agent results reach
   the world only as logged actions dispatched by MC.ai.fleet. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var AI = MC.ai = MC.ai || {};

  var URL = 'https://api.anthropic.com/v1/messages';
  var VERSION = '2026-10-21';
  var MODEL = 'claude-haiku-5-5';
  var LS_KEY = 'mc.ai.key';
  var TOKEN_KEY = 'mc.ai.token';      // bearer tokens: sessionStorage only, never localStorage
  var EXPIRING_MS = 120000;           // at T-120s the state becomes 'expiring'
  var MAX_TIMER = 2147483647;
  var MAX_CONCURRENT = 3;
  // USD per million tokens. Cache reads bill at 0.1x input; 5-minute cache writes at 1.25x input.
  var PRICE = { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 };

  AI.MODEL = MODEL;
  // Shown in the Connect panel. Enforced by MC.ai.context.scrub(): context is aggregates only.
  AI.DATA_POLICY = 'Only aggregated campaign and audience numbers are sent to Anthropic — never individual customer records.';
  AI.MODEL_LABEL = 'Haiku 5.5';
  AI.KEY_URL = 'https://platform.claude.com/settings/keys';
  AI.EXPIRING_MS = EXPIRING_MS;
  AI.PRICE = PRICE;
  AI.MAX_CONCURRENT = MAX_CONCURRENT;

  function report(e) { if (window.console && console.error) console.error(e); }
  function wall() { return Date.now(); }   // token lifetimes are real time, never the simulated clock
  function clock() { try { return MC.util && MC.util.now ? MC.util.now() : Date.now(); } catch (e) { return Date.now(); } }
  function assign(a, b) { return Object.assign(a, b); }

  /* ---------------- state ---------------- */
  var st = { state: 'off', message: '', remember: true, verifiedAt: null };
  // key = the secret in use (API key or bearer token); auth = how it is presented: {kind:'apiKey', key} | {kind:'bearer', token, expiresAt, source}
  var key = null, auth = null, expiryTimer = null;
  var usage = { calls: 0, agentRuns: 0, tasks: 0, fallbacks: 0, errors: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, ms: 0 };
  var subs = [];

  function emit() {
    var l = subs.slice();
    for (var i = 0; i < l.length; i++) { try { l[i](AI.getState()); } catch (e) { report(e); } }
  }
  function setState(s, message) {
    if (st.state === s && st.message === (message || '')) return;
    st.state = s; st.message = message || '';
    emit();
  }

  AI.subscribe = function (fn) {
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  };
  AI.isOn = function () { checkExpiry(); return (st.state === 'on' || st.state === 'expiring') && !!key; };
  AI.state = function () { checkExpiry(); return st.state; };
  AI.getState = function () {
    return { state: st.state, message: st.message, remember: st.remember, hasKey: !!key, model: MODEL, modelLabel: AI.MODEL_LABEL,
      authKind: AI.authKind(), expiresAt: AI.expiresAt(), source: auth && auth.kind === 'bearer' ? auth.source : null, expiredSource: st.expiredSource || null,
      usage: AI.usage(), inFlight: active, queued: queue.length };
  };
  AI.usage = function () { return assign({}, usage); };
  // "This session: 42 agent runs · about $0.03"
  AI.usageLine = function () {
    var c = usage.cost, money = c < 0.005 ? 'under $0.01' : 'about $' + c.toFixed(2);
    var parts = [];
    parts.push(usage.agentRuns + (usage.agentRuns === 1 ? ' agent run' : ' agent runs'));
    if (usage.tasks) parts.push(usage.tasks + (usage.tasks === 1 ? ' request' : ' requests'));
    return 'This session: ' + parts.join(' · ') + ' · ' + money;
  };
  AI.resetUsage = function () { Object.keys(usage).forEach(function (k) { usage[k] = 0; }); emit(); };
  AI.noteFallback = function () { usage.fallbacks++; emit(); };
  AI.noteRun = function (kind) { if (kind === 'agent') usage.agentRuns++; else usage.tasks++; emit(); };

  /* ---------------- key storage (§12.3) ---------------- */
  function store(kind) { try { return window[kind] || null; } catch (e) { return null; } }
  function readKey() {
    var l = store('localStorage'), s = store('sessionStorage'), v = null;
    try { v = l && l.getItem(LS_KEY); if (v) { st.remember = true; return v; } } catch (e) { /* blocked */ }
    try { v = s && s.getItem(LS_KEY); if (v) { st.remember = false; return v; } } catch (e) { /* blocked */ }
    return null;
  }
  function writeKey(k, remember) {
    clearKey();
    var tgt = store(remember ? 'localStorage' : 'sessionStorage');
    try { if (tgt) tgt.setItem(LS_KEY, k); } catch (e) { report(e); }
  }
  function clearKey() {
    ['localStorage', 'sessionStorage'].forEach(function (n) { var s = store(n); try { if (s) s.removeItem(LS_KEY); } catch (e) { /* blocked */ } });
  }
  // Bearer tokens are short-lived credentials: sessionStorage (this tab) only.
  function writeToken(a) {
    var s = store('sessionStorage');
    try { if (s) s.setItem(TOKEN_KEY, JSON.stringify({ token: a.token, expiresAt: a.expiresAt || null, source: a.source })); } catch (e) { report(e); }
  }
  function readToken() {
    var s = store('sessionStorage'), v = null;
    try { v = s && s.getItem(TOKEN_KEY); v = v ? JSON.parse(v) : null; } catch (e) { v = null; }
    if (!v || !AI.isTokenLike(v.token)) return null;
    return { kind: 'bearer', token: v.token, expiresAt: typeof v.expiresAt === 'number' ? v.expiresAt : null, source: v.source === 'federated' ? 'federated' : 'pasted' };
  }
  function clearToken() {
    ['localStorage', 'sessionStorage'].forEach(function (n) { var s = store(n); try { if (s) s.removeItem(TOKEN_KEY); } catch (e) { /* blocked */ } });
  }
  AI.isTokenLike = function (s) { return typeof s === 'string' && /^sk-ant-oat[0-9]{2}-[A-Za-z0-9_\-]{8,}$/.test(s.trim()); };
  AI.isKeyLike = function (s) { return typeof s === 'string' && !AI.isTokenLike(s) && /^sk-ant-[A-Za-z0-9_\-]{8,}$/.test(s.trim()); };
  AI.keyHint = function () { return key ? key.slice(0, 10) + '…' + key.slice(-4) : ''; };
  AI.authKind = function () { return auth ? auth.kind : null; };
  AI.expiresAt = function () { return auth && auth.kind === 'bearer' && auth.expiresAt ? auth.expiresAt : null; };

  /* ---------------- bearer expiry: on -> expiring (T-120s) -> expired (agents fall back to rules) ---------------- */
  function checkExpiry() {
    if (!auth || auth.kind !== 'bearer' || !auth.expiresAt) return;
    if (st.state !== 'on' && st.state !== 'expiring') return;
    var left = auth.expiresAt - wall();
    if (left <= 0) { expire(); }
    else if (left <= EXPIRING_MS && st.state === 'on') setState('expiring', 'This token expires soon.');
  }
  function expire() {
    var a = auth;
    key = null; auth = null; clearToken(); armExpiry();
    queue.forEach(function (j) { j.cancelled = true; });
    st.expiredSource = a ? a.source : null;
    setState('expired', 'Your access token expired. Agents are using rules until you renew it.');
  }
  function armExpiry() {
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    if (!auth || auth.kind !== 'bearer' || !auth.expiresAt) return;
    var left = auth.expiresAt - wall();
    var next = left <= EXPIRING_MS ? left : left - EXPIRING_MS;
    expiryTimer = setTimeout(function () { expiryTimer = null; checkExpiry(); armExpiry(); }, Math.min(Math.max(next, 0) + 5, MAX_TIMER));
  }
  function parseExpiry(v) {
    if (v === undefined || v === null || v === '') return null;
    var t = typeof v === 'number' ? v : (v instanceof Date ? v.getTime() : Date.parse(String(v)));
    return isFinite(t) ? t : NaN;
  }

  /* ---------------- raw request ---------------- */
  function cleanSystem(sys) {
    if (!sys) return undefined;
    if (typeof sys === 'string') return [{ type: 'text', text: sys }];
    return sys.filter(function (b) { return b && b.text; });
  }

  function addUsage(u) {
    if (!u) return;
    var inp = u.input_tokens || 0, out = u.output_tokens || 0, cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    usage.input += inp; usage.output += out; usage.cacheRead += cr; usage.cacheWrite += cw;
    usage.cost += (inp * PRICE.input + out * PRICE.output + cr * PRICE.cacheRead + cw * PRICE.cacheWrite) / 1e6;
  }

  function authFailure(status, msg, kind) {
    if (status !== 401) return null;
    if (/^CORS requests are not allowed/i.test(msg || '')) return { state: 'blocked', text: 'Your organization doesn’t allow browser access' };
    if (kind === 'bearer') return { state: 'invalid', text: 'That token didn’t work. It may have expired, or your organization may not allow it.' };
    return { state: 'invalid', text: 'That key didn’t work' };
  }
  function authOf(k) { return k && typeof k === 'object' ? k : { kind: 'apiKey', key: k }; }

  // One HTTP attempt. Resolves {ok, status, json?, error?, retryAfter?}; never rejects.
  function attempt(a, body, timeoutMs) {
    a = authOf(a);
    return new Promise(function (resolve) {
      var done = false, ctl = null, timer = null;
      function finish(r) { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(r); }
      if (typeof fetch !== 'function') { finish({ ok: false, status: 0, error: 'offline' }); return; }
      try { ctl = typeof AbortController === 'function' ? new AbortController() : null; } catch (e) { ctl = null; }
      timer = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) { /* ignore */ } finish({ ok: false, status: 0, error: 'timeout' }); }, timeoutMs);
      var headers = { 'anthropic-version': VERSION, 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' };
      if (a.kind === 'bearer') headers.authorization = 'Bearer ' + a.token; else headers['x-api-key'] = a.key;
      var init = { method: 'POST', headers: headers, body: JSON.stringify(body) };
      if (ctl) init.signal = ctl.signal;
      var p;
      try { p = fetch(URL, init); } catch (e) { finish({ ok: false, status: 0, error: 'network' }); return; }
      p.then(function (res) {
        var ra = null;
        try { ra = res.headers && res.headers.get ? res.headers.get('retry-after') : null; } catch (e) { ra = null; }
        return res.text().then(function (txt) {
          var json = null;
          try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = null; }
          if (res.status >= 200 && res.status < 300) { finish({ ok: true, status: res.status, json: json }); return; }
          var msg = json && json.error && json.error.message ? String(json.error.message) : '';
          finish({ ok: false, status: res.status, error: msg || ('http ' + res.status), retryAfter: ra });
        });
      }, function (e) { finish({ ok: false, status: 0, error: (e && e.name === 'AbortError') ? 'timeout' : 'network' }); });
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Request with the §12.2 error policy: 401 -> invalid/blocked; 429 -> honour retry-after once; 5xx/network -> fail.
  function request(a, body, opts) {
    var deadline = clock() + (opts.timeoutMs || 30000);
    function left() { return Math.max(1, deadline - clock()); }
    return attempt(a, body, left()).then(function (r) {
      if (r.ok || r.status !== 429 || opts.noRetry) return r;
      var wait = parseFloat(r.retryAfter);
      wait = isFinite(wait) && wait >= 0 ? wait * 1000 : 1000;
      if (wait >= left() - 200) return r;
      return sleep(wait).then(function () { return attempt(a, body, left()); });
    });
  }

  function parseResponse(json) {
    if (!json || typeof json !== 'object') return { ok: false, error: 'invalid-json' };
    if (json.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
    if (json.stop_reason === 'max_tokens') return { ok: false, error: 'max-tokens' };
    var blocks = Array.isArray(json.content) ? json.content : [], text = null;
    for (var i = 0; i < blocks.length; i++) if (blocks[i] && blocks[i].type === 'text') { text = blocks[i].text; break; }
    if (typeof text !== 'string') return { ok: false, error: 'no-text' };
    try { return { ok: true, data: JSON.parse(text), text: text }; } catch (e) { return { ok: false, error: 'invalid-json', text: text }; }
  }

  /* ---------------- queue (at most 3 in flight) ---------------- */
  var queue = [], active = 0;
  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      var job = queue.shift();
      if (job.cancelled) continue;
      active++;
      job.run().then(function () { active--; pump(); }, function () { active--; pump(); });
    }
  }

  // call(opts) -> Promise<{ok, data?, error?, usage, ms}>. Never rejects.
  // opts: {system: string|blocks, messages?|user?: string, schema?, maxTokens?, effort?, timeoutMs? (whole call, queue wait included), requestMs? (the request alone), kind?: 'agent'|'task', name?}
  AI.call = function (opts) {
    opts = opts || {};
    var t0 = clock();
    return new Promise(function (resolve) {
      function fail(err) { resolve({ ok: false, error: err, usage: null, ms: clock() - t0 }); }
      if (!AI.isOn()) { fail('off'); return; }
      checkExpiry();
      var a = auth;
      var body = { model: MODEL, max_tokens: opts.maxTokens || (opts.kind === 'agent' ? 4000 : 2000),
        output_config: { effort: opts.effort || 'low' } };
      if (opts.schema) body.output_config.format = { type: 'json_schema', schema: opts.schema };
      var sys = cleanSystem(opts.system);
      if (sys && sys.length) body.system = sys;
      body.messages = opts.messages || [{ role: 'user', content: String(opts.user || '') }];
      var job = {
        run: function () {
          var total = Math.max(1, (opts.timeoutMs || 30000) - (clock() - t0));
          var timeout = opts.requestMs ? Math.min(opts.requestMs, total) : total;   // requestMs: the request's own budget, queue wait not counted
          return request(a, body, { timeoutMs: timeout }).then(function (r) {
            usage.calls++;
            usage.ms += clock() - t0;
            if (!r.ok) {
              usage.errors++;
              var af = authFailure(r.status, r.error, a.kind);
              if (af && a === auth) {
                var bearer = a.kind === 'bearer';
                key = null; auth = null; clearKey(); clearToken(); armExpiry();
                setState(bearer && af.state === 'invalid' ? 'expired' : af.state, bearer && af.state === 'invalid' ? 'Your access token was refused or has expired. Agents are using rules until you renew it.' : af.text);
              } else emit();
              fail(r.status === 429 ? 'rate-limited' : (af ? af.state : (r.status >= 500 ? 'server' : (r.error === 'timeout' ? 'timeout' : (r.status ? 'http-' + r.status : 'network')))));
              return;
            }
            addUsage(r.json && r.json.usage);
            var pr = parseResponse(r.json);
            emit();
            var u = r.json && r.json.usage ? r.json.usage : null;
            if (!pr.ok) { resolve({ ok: false, error: pr.error, usage: u, ms: clock() - t0, text: pr.text }); return; }
            resolve({ ok: true, data: pr.data, usage: u, ms: clock() - t0 });
          });
        }
      };
      if (opts.timeoutMs) setTimeout(function () { if (queue.indexOf(job) >= 0) { job.cancelled = true; queue.splice(queue.indexOf(job), 1); fail('timeout'); } }, opts.timeoutMs);
      queue.push(job);
      pump();
    });
  };

  /* ---------------- connect / verify / disconnect ---------------- */
  function verifyAuth(a) {
    var body = { model: MODEL, max_tokens: 16, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with OK.' }] };
    return request(a, body, { timeoutMs: 15000 }).then(function (r) {
      if (r.ok) { addUsage(r.json && r.json.usage); usage.calls++; return { ok: true, state: 'on' }; }
      var af = authFailure(r.status, r.error, a.kind);
      if (af) return { ok: false, state: af.state, error: af.text };
      if (r.status === 429) return { ok: false, state: 'off', error: 'Anthropic is busy right now. Try again in a minute.' };
      if (!r.status) return { ok: false, state: 'off', error: 'Couldn’t reach Anthropic. Check your connection and try again.' };
      return { ok: false, state: 'off', error: 'Anthropic answered with an error (' + r.status + '). Try again in a minute.' };
    });
  }
  // A failed new credential never disturbs a working connection.
  function failed(r, prev) {
    setState(key && (prev === 'on' || prev === 'expiring') ? prev : (r.state === 'blocked' || r.state === 'invalid' ? r.state : 'off'), r.error);
    return r;
  }

  // verifyKey(key) -> Promise<{ok, state, error?}>: one tiny Haiku call (max_tokens 16). Does not store the key.
  AI.verifyKey = function (k) {
    k = typeof k === 'string' ? k.trim() : '';
    if (!AI.isKeyLike(k)) return Promise.resolve({ ok: false, state: 'invalid', error: 'That doesn’t look like an Anthropic key (they start with sk-ant-).' });
    return verifyAuth({ kind: 'apiKey', key: k });
  };
  // verifyToken(token) -> same tiny call with Authorization: Bearer. Does not store the token.
  AI.verifyToken = function (t) {
    t = typeof t === 'string' ? t.trim() : '';
    if (!AI.isTokenLike(t)) return Promise.resolve({ ok: false, state: 'invalid', error: 'That doesn’t look like a federated access token (they start with sk-ant-oat).' });
    return verifyAuth({ kind: 'bearer', token: t });
  };

  function adopt(a) {
    key = a.kind === 'bearer' ? a.token : a.key; auth = a;
    st.verifiedAt = clock(); st.expiredSource = null;
    armExpiry();
  }

  // connect(key, {remember=true}) -> Promise<{ok, state, error?}>: verify, then store and switch on.
  // A federated access token (sk-ant-oat…) given here is routed to connectToken.
  AI.connect = function (k, opts) {
    opts = opts || {};
    k = typeof k === 'string' ? k.trim() : '';
    if (AI.isTokenLike(k)) return AI.connectToken(k, opts);
    var remember = opts.remember !== false, prev = st.state;
    setState('connecting');
    return AI.verifyKey(k).then(function (r) {
      if (!r.ok) return failed(r, prev);
      adopt({ kind: 'apiKey', key: k }); st.remember = remember;
      clearToken(); writeKey(k, remember);
      setState('on');
      return r;
    });
  };

  // connectToken(token, {expiresAt?, source?='pasted'}) -> Promise<{ok, state, error?}>: verify, keep in sessionStorage only, switch on.
  // expiresAt: epoch ms, Date or ISO string; unknown is allowed (a 401 later ends the connection).
  AI.connectToken = function (t, opts) {
    opts = opts || {};
    t = typeof t === 'string' ? t.trim() : '';
    var exp = parseExpiry(opts.expiresAt);
    if (exp !== null && isNaN(exp)) return Promise.resolve({ ok: false, state: 'invalid', error: 'That expiry time isn’t a valid date.' });
    if (exp !== null && exp <= wall()) return Promise.resolve({ ok: false, state: 'expired', error: 'That token has already expired.' });
    var prev = st.state;
    setState('connecting');
    return AI.verifyToken(t).then(function (r) {
      if (!r.ok) return failed(r, prev);
      var a = { kind: 'bearer', token: t, expiresAt: exp, source: opts.source === 'federated' ? 'federated' : 'pasted' };
      adopt(a); st.remember = false;
      clearKey(); writeToken(a);
      setState('on');
      checkExpiry();
      return r;
    });
  };

  AI.setRemember = function (remember) {
    st.remember = !!remember;
    if (key && auth && auth.kind === 'apiKey') writeKey(key, st.remember);
    emit();
  };

  AI.disconnect = function () {
    key = null; auth = null; st.expiredSource = null;
    clearKey(); clearToken(); armExpiry();
    queue.forEach(function (j) { j.cancelled = true; });
    setState('off');
  };

  // Reads a stored key (or this tab's token) at load and re-verifies it quietly.
  AI.restore = function () {
    var tok = readToken();
    if (tok && !readKey()) {
      if (tok.expiresAt && tok.expiresAt <= wall()) { clearToken(); setState('expired', 'Your access token expired. Agents are using rules until you renew it.'); return Promise.resolve({ ok: false, state: 'expired' }); }
      setState('connecting');
      return verifyAuth(tok).then(function (r) {
        if (r.ok) { adopt(tok); st.remember = false; setState('on'); checkExpiry(); }
        else if (r.state === 'invalid' || r.state === 'blocked') { clearToken(); setState(r.state === 'invalid' ? 'expired' : r.state, r.state === 'invalid' ? 'Your access token was refused or has expired. Agents are using rules until you renew it.' : r.error); }
        else { adopt(tok); st.remember = false; setState('on'); checkExpiry(); }
        return r;
      });
    }
    var k = readKey();
    if (!k) return Promise.resolve({ ok: false, state: 'off' });
    setState('connecting');
    return AI.verifyKey(k).then(function (r) {
      if (r.ok) { adopt({ kind: 'apiKey', key: k }); setState('on'); }
      else if (r.state === 'invalid' || r.state === 'blocked') { setState(r.state, r.error); }
      else { adopt({ kind: 'apiKey', key: k }); setState('on'); }    // offline/busy at load: keep the key; calls fall back until it answers
      return r;
    });
  };

  if (typeof window.fetch === 'function' && store('localStorage') !== null) {
    setTimeout(function () { AI.restore().catch(report); }, 0);
  }

  AI._test = { parseResponse: parseResponse, setKey: function (k) { key = k; auth = k ? { kind: 'apiKey', key: k } : null; armExpiry(); setState(k ? 'on' : 'off'); },
    setToken: function (t, exp) { var a = { kind: 'bearer', token: t, expiresAt: exp || null, source: 'pasted' }; adopt(a); setState('on'); checkExpiry(); },
    checkExpiry: checkExpiry };
})();
