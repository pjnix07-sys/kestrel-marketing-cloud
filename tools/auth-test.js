// Offline tests for Claude authentication: bearer tokens, expiry, storage, PKCE, the sign-in callback and the WIF relay worker.
// No network, no browser. Usage: node tools/auth-test.js      exit 0 = all pass
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), nodeCrypto = require('crypto');
const root = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  ' + detail : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- a fresh browser-like context ---------- */
function makeStore() { const m = {}; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }
function boot() {
  const clock = { now: 1_800_000_000_000 };
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(clock.now); }
  FakeDate.now = () => clock.now; FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC; FakeDate.prototype = RealDate.prototype;
  const calls = [];                      // every fetch: {url, init}
  const routes = [];                     // [(url, init) => response | undefined]
  const ctx = { console, setTimeout, clearTimeout, Math, Date: FakeDate, JSON, Promise, AbortController, Uint8Array, Object, Array, String, Number, isFinite, encodeURIComponent, decodeURIComponent,
    TextEncoder, TextDecoder, crypto: nodeCrypto.webcrypto, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    localStorage: makeStore(), sessionStorage: makeStore(), location: { search: '', pathname: '/index.html', hash: '#/agents' }, history: { replaced: [], replaceState(a, b, u) { this.replaced.push(u); } } };
  ctx.window = ctx; ctx.performance = { now: () => 0 };
  ctx.fetch = (url, init) => {
    calls.push({ url, init: init || {} });
    for (const r of routes) { const x = r(url, init || {}); if (x) return Promise.resolve(x); }
    return Promise.resolve(res(404, {}));
  };
  vm.createContext(ctx);
  for (const f of ['js/config.js', 'js/ai/client.js', 'js/ai/federation.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  return { ctx, MC: ctx.MC, AI: ctx.MC.ai, F: ctx.MC.ai.federation, clock, calls, routes };
}
function res(status, json, headers) { return { status, ok: status >= 200 && status < 300, headers: { get: k => (headers || {})[k.toLowerCase()] || null }, text: () => Promise.resolve(typeof json === 'string' ? json : JSON.stringify(json)), json: () => Promise.resolve(json) }; }
const haiku = { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 10, output_tokens: 5 } };
const TOKEN = 'sk-ant-oat01-' + 'A'.repeat(40), TOKEN2 = 'sk-ant-oat01-' + 'B'.repeat(40), KEY = 'sk-ant-api03-' + 'k'.repeat(30);
function anthropicRoute(b, accept) {      // accept(headers) -> bool
  b.routes.push((url, init) => {
    if (url !== 'https://api.anthropic.com/v1/messages') return undefined;
    return accept(init.headers) ? res(200, haiku) : res(401, { error: { message: 'Authentication failed' } });
  });
}
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const jwt = claims => b64u({ alg: 'RS256', typ: 'JWT' }) + '.' + b64u(claims) + '.' + b64u('sig');

const FED = { idpName: 'Acme SSO', issuer: 'https://login.acme.test', clientId: 'client-1', scopes: 'openid', redirectUri: 'https://app.acme.test/index.html',
  relayUrl: 'https://relay.acme.test', federationRuleId: 'fdrl_abc', organizationId: '11111111-1111-1111-1111-111111111111', workspaceId: 'wrkspc_xyz' };

(async () => {
  /* ---------- bearer header, no x-api-key ---------- */
  {
    const b = boot(); anthropicRoute(b, h => h.authorization === 'Bearer ' + TOKEN && !('x-api-key' in h));
    const r = await b.AI.connectToken(TOKEN);
    check('bearer: connectToken verifies with Authorization: Bearer', r.ok && b.AI.state() === 'on', JSON.stringify(r));
    const h = b.calls[0].init.headers;
    check('bearer: no x-api-key header', !('x-api-key' in h) && h['anthropic-dangerous-direct-browser-access'] === 'true' && h['anthropic-version'] === '2026-10-21', JSON.stringify(h));
    const c = await b.AI.call({ user: 'hi' });
    check('bearer: agent calls use the bearer header too', c.ok && b.calls[1].init.headers.authorization === 'Bearer ' + TOKEN && !('x-api-key' in b.calls[1].init.headers), JSON.stringify(c));
    check('bearer: only api.anthropic.com is contacted', b.calls.every(x => x.url.startsWith('https://api.anthropic.com/')));
    check('bearer: authKind/expiresAt/getState', b.AI.authKind() === 'bearer' && b.AI.expiresAt() === null && b.AI.getState().authKind === 'bearer' && b.AI.getState().source === 'pasted');
    check('bearer: a token is not accepted as an API key and vice versa', !b.AI.isKeyLike(TOKEN) && b.AI.isTokenLike(TOKEN) && b.AI.isKeyLike(KEY) && !b.AI.isTokenLike(KEY));
    // api key mode is unchanged
    const k = boot(); anthropicRoute(k, h => h['x-api-key'] === KEY && !('authorization' in h));
    const kr = await k.AI.connect(KEY, { remember: true });
    check('apiKey: x-api-key, no authorization header, authKind apiKey', kr.ok && k.AI.authKind() === 'apiKey' && !('authorization' in k.calls[0].init.headers));
    check('apiKey: remember=true goes to localStorage only', k.ctx.localStorage.getItem('mc.ai.key') === KEY && k.ctx.sessionStorage.getItem('mc.ai.key') === null);
  }

  /* ---------- storage: sessionStorage only ---------- */
  {
    const b = boot(); anthropicRoute(b, () => true);
    await b.AI.connectToken(TOKEN, { expiresAt: b.clock.now + 3600e3, source: 'federated' });
    const ls = b.ctx.localStorage.m, ss = b.ctx.sessionStorage.m;
    check('storage: token only in sessionStorage', Object.keys(ls).length === 0 && /sk-ant-oat01/.test(ss['mc.ai.token'] || ''), JSON.stringify(Object.keys(ls)));
    check('storage: token never written under the key name or to localStorage', !('mc.ai.key' in ss) && !Object.values(ls).some(v => /oat/.test(v)));
    b.AI.setRemember(true);
    check('storage: setRemember does not move a token to localStorage', Object.keys(b.ctx.localStorage.m).length === 0);
    // restore in a new page load (same sessionStorage)
    const b2 = boot(); b2.ctx.sessionStorage.m['mc.ai.token'] = ss['mc.ai.token']; anthropicRoute(b2, h => h.authorization === 'Bearer ' + TOKEN);
    const rr = await b2.AI.restore();
    check('storage: restore re-verifies the tab token and turns on', rr.ok && b2.AI.state() === 'on' && b2.AI.expiresAt() === b.clock.now + 3600e3 && b2.AI.getState().source === 'federated');
    b.AI.disconnect();
    check('storage: disconnect clears the token', b.ctx.sessionStorage.getItem('mc.ai.token') === null && b.AI.state() === 'off');
    // switching from key to token clears the key
    const c = boot(); anthropicRoute(c, () => true);
    await c.AI.connect(KEY, { remember: true }); await c.AI.connectToken(TOKEN);
    check('storage: connecting a token replaces a stored key', c.ctx.localStorage.getItem('mc.ai.key') === null && c.AI.authKind() === 'bearer');
    // connect() routes a pasted oat token to the bearer path
    const d = boot(); anthropicRoute(d, h => !!h.authorization);
    const dr = await d.AI.connect(TOKEN, { remember: true });
    check('storage: connect() given a token uses bearer and never localStorage', dr.ok && d.AI.authKind() === 'bearer' && Object.keys(d.ctx.localStorage.m).length === 0);
  }

  /* ---------- expiry: on -> expiring (T-120s) -> expired, agents fall back ---------- */
  {
    const b = boot(); anthropicRoute(b, h => /^Bearer sk-ant-oat01-/.test(h.authorization));
    const seen = []; b.AI.subscribe(g => { if (seen[seen.length - 1] !== g.state) seen.push(g.state); });
    const exp = b.clock.now + 300e3;
    await b.AI.connectToken(TOKEN, { expiresAt: exp });
    check('expiry: expiresAt() reports the time', b.AI.expiresAt() === exp);
    b.clock.now = exp - 121e3;
    check('expiry: still on at T-121s', b.AI.state() === 'on' && b.AI.isOn());
    b.clock.now = exp - 119e3;
    check('expiry: expiring at T-119s, still usable', b.AI.state() === 'expiring' && b.AI.isOn());
    const mid = await b.AI.call({ user: 'x' });
    check('expiry: calls still work while expiring', mid.ok);
    b.clock.now = exp + 1000;
    const late = await b.AI.call({ user: 'x' });
    check('expiry: expired -> call resolves {ok:false,error:off} (no throw, no request)', !late.ok && late.error === 'off' && b.AI.state() === 'expired' && !b.AI.isOn(), JSON.stringify(late));
    const before = b.calls.length; await b.AI.call({ user: 'y' });
    check('expiry: no request is sent with an expired token', b.calls.length === before);
    check('expiry: token removed from sessionStorage, message set', b.ctx.sessionStorage.getItem('mc.ai.token') === null && /expired/i.test(b.AI.getState().message));
    check('expiry: state sequence on, expiring, expired', seen.join(',').includes('on,expiring,expired'), seen.join(','));
    const past = await b.AI.connectToken(TOKEN2, { expiresAt: b.clock.now - 1000 });
    check('expiry: an already-expired token is refused', !past.ok && /expired/i.test(past.error));
    const bad = await b.AI.connectToken(TOKEN2, { expiresAt: 'not a date' });
    check('expiry: an invalid expiry is refused', !bad.ok);
    // a renewed token brings it back on
    const again = await b.AI.connectToken(TOKEN2, { expiresAt: b.clock.now + 3600e3 });
    check('expiry: renewing with a new token turns it on again', again.ok && b.AI.state() === 'on');
    // 401 mid-session on a token with unknown expiry ends it quietly
    const u = boot(); let ok401 = true; u.routes.push(() => (ok401 ? res(200, haiku) : res(401, { error: { message: 'Authentication failed' } })));
    await u.AI.connectToken(TOKEN); ok401 = false;
    const r401 = await u.AI.call({ user: 'x' });
    check('expiry: a 401 drops the token, state expired, call resolves not-ok', !r401.ok && u.AI.state() === 'expired' && !u.AI.isOn() && u.ctx.sessionStorage.getItem('mc.ai.token') === null, JSON.stringify(r401));
    // a bad new token never disturbs a working connection
    const w = boot(); anthropicRoute(w, h => h.authorization === 'Bearer ' + TOKEN);
    await w.AI.connectToken(TOKEN); const badTok = await w.AI.connectToken(TOKEN2);
    check('expiry: a failed new token leaves the working one on', !badTok.ok && w.AI.state() === 'on' && w.AI.isOn());
  }

  /* ---------- PKCE ---------- */
  {
    const b = boot(), F = b.F;
    const p = await F.pkce(), p2 = await F.pkce();
    check('pkce: verifier is 43-128 URL-safe characters (64 here)', /^[A-Za-z0-9_-]{43,128}$/.test(p.verifier) && p.verifier.length === 64, p.verifier);
    check('pkce: challenge = base64url(SHA-256(verifier)), method S256', p.challenge === nodeCrypto.createHash('sha256').update(p.verifier).digest('base64url') && p.method === 'S256');
    check('pkce: verifiers are random', p.verifier !== p2.verifier);
  }

  /* ---------- sign-in: begin + callback ---------- */
  async function signInFixture(over) {
    const b = boot(); b.MC.CONFIG.federation = Object.assign({}, FED, over || {});
    b.routes.push(u => (u === 'https://login.acme.test/.well-known/openid-configuration' ? res(200, { issuer: 'https://login.acme.test', authorization_endpoint: 'https://login.acme.test/authorize', token_endpoint: 'https://login.acme.test/token' }) : undefined));
    anthropicRoute(b, h => h.authorization === 'Bearer ' + TOKEN);
    let nav = null; b.F.navigate = u => { nav = new URL(u); };
    return { b, nav: () => nav };
  }
  {
    const { b, nav } = await signInFixture();
    check('signin: enabled only when configured', b.F.enabled() && b.F.idpName() === 'Acme SSO' && !boot().F.enabled());
    const r = await b.F.signIn();
    const u = nav(), q = u.searchParams, pend = JSON.parse(b.ctx.sessionStorage.getItem('mc.fed.pending'));
    check('signin: redirects to the discovered authorization endpoint with code + S256', r.ok && u.origin + u.pathname === 'https://login.acme.test/authorize' && q.get('response_type') === 'code' && q.get('code_challenge_method') === 'S256' && q.get('client_id') === 'client-1' && q.get('redirect_uri') === FED.redirectUri && q.get('scope') === 'openid');
    check('signin: no prompt=none on an interactive sign-in', !q.has('prompt'));
    check('signin: state, nonce, verifier kept in sessionStorage only', pend.state === q.get('state') && pend.nonce === q.get('nonce') && nodeCrypto.createHash('sha256').update(pend.verifier).digest('base64url') === q.get('code_challenge') && Object.keys(b.ctx.localStorage.m).length === 0);
    check('signin: the verifier is not in the URL', !u.href.includes(pend.verifier));
    await b.F.renew();
    check('signin: renewal asks silently with prompt=none', nav().searchParams.get('prompt') === 'none');
  }
  async function callback(opts) {
    // opts: {stateOk, nonceOk, claims, relay, silent, error}
    const { b, nav } = await signInFixture(opts.cfg);
    await (opts.silent ? b.F.renew() : b.F.signIn());
    const q = nav().searchParams, state = q.get('state'), nonce = q.get('nonce');
    const idt = jwt(Object.assign({ iss: 'https://login.acme.test', aud: 'client-1', exp: Math.floor(b.clock.now / 1000) + 600, nonce: opts.nonceOk === false ? 'other' : nonce, sub: 'u1' }, opts.claims || {}));
    b.routes.push((url, init) => (url === 'https://login.acme.test/token' ? (b.tokenCall = init, res(200, { id_token: idt })) : undefined));
    b.routes.push((url, init) => (url === 'https://relay.acme.test' ? (b.relayCall = init, opts.relay ? opts.relay() : res(200, { access_token: TOKEN, expires_in: 900, token_type: 'Bearer', scope: 'workspace:inference' })) : undefined));
    b.calls.length = 0;
    b.ctx.location.search = opts.error ? '?error=' + opts.error + '&state=' + (opts.stateOk === false ? 'wrong' : state) : '?code=abc123&state=' + (opts.stateOk === false ? 'wrong' : state);
    b.ctx.history.replaced.length = 0;
    const out = await b.F.handleRedirect();
    return { b, out };
  }
  {
    const { b, out } = await callback({});
    check('callback: success connects with a federated token', out && out.ok && b.AI.state() === 'on' && b.AI.authKind() === 'bearer' && b.AI.getState().source === 'federated', JSON.stringify(out));
    check('callback: URL cleaned (code/state gone, route hash kept)', b.ctx.history.replaced[0] === '/index.html#/agents', JSON.stringify(b.ctx.history.replaced));
    check('callback: pending record is single-use', b.ctx.sessionStorage.getItem('mc.fed.pending') === null);
    const tb = String(b.tokenCall.body);
    check('callback: code exchange sends the PKCE verifier (form POST to the IdP)', /grant_type=authorization_code/.test(tb) && /code_verifier=[A-Za-z0-9_-]{64}/.test(tb) && /code=abc123/.test(tb));
    const rb = JSON.parse(b.relayCall.body);
    check('callback: relay gets the assertion and the configured ids only', Object.keys(rb).sort().join() === 'assertion,federation_rule_id,organization_id,workspace_id' && rb.federation_rule_id === 'fdrl_abc' && rb.organization_id === FED.organizationId && rb.workspace_id === 'wrkspc_xyz' && rb.assertion.split('.').length === 3);
    check('callback: expiry comes from expires_in', b.AI.expiresAt() === b.clock.now + 900e3);
    check('callback: relay called without credentials/cookies, token only stored in sessionStorage', b.relayCall.credentials === 'omit' && Object.keys(b.ctx.localStorage.m).length === 0 && !JSON.stringify(b.ctx.sessionStorage.m).includes('id_token'));
    check('callback: the access token went only to api.anthropic.com (and IdP/relay got none)', !String(b.tokenCall.body).includes(TOKEN) && !String(b.relayCall.body).includes(TOKEN));
    check('callback: status back to idle', b.F.status().phase === 'idle');
  }
  {
    const { b, out } = await callback({ stateOk: false });
    check('callback: state mismatch rejected, nothing exchanged', out && !out.ok && out.error === 'state' && b.AI.state() === 'off' && !b.calls.some(c => /token$|relay/.test(c.url)) && b.F.status().phase === 'error', JSON.stringify(out));
    check('callback: state mismatch still cleans the URL', b.ctx.history.replaced.length === 1);
    const n = await callback({ nonceOk: false });
    check('callback: nonce mismatch rejected before the relay is called', n.out && !n.out.ok && n.out.error === 'nonce' && !n.b.relayCall && n.b.AI.state() === 'off', JSON.stringify(n.out));
    const a = await callback({ claims: { aud: 'someone-else' } });
    check('callback: wrong audience rejected', !a.out.ok && a.out.error === 'claims' && !a.b.relayCall);
    const e = await callback({ claims: { exp: 1 } });
    check('callback: expired ID token rejected', !e.out.ok && e.out.error === 'claims' && !e.b.relayCall);
    const s = await callback({ silent: true, error: 'login_required' });
    check('callback: silent renewal refused -> asks for an interactive sign-in', !s.out.ok && s.out.error === 'interactive' && /sign in again/i.test(s.b.F.status().message));
    const o = await boot().F.handleRedirect();
    check('callback: a normal page load is not a callback', o === null || o === undefined);
    const lone = boot(); lone.MC.CONFIG.federation = FED; lone.ctx.location.search = '?code=x&state=y';
    const lr = await lone.F.handleRedirect();
    check('callback: a callback with no pending sign-in is rejected', !lr.ok && lr.error === 'state');
  }
  /* ---------- relay response handling ---------- */
  {
    const cases = [
      ['401 -> denied', () => res(401, { error: 'authentication_failed' }), 'denied'], ['403 -> denied', () => res(403, {}), 'denied'], ['429 -> busy', () => res(429, {}), 'busy'],
      ['500 -> relay', () => res(500, {}), 'relay'], ['not json -> badresponse', () => res(200, 'oops'), 'badresponse'],
      ['api key shaped token -> badresponse', () => res(200, { access_token: KEY, expires_in: 10 }), 'badresponse'],
      ['missing expires_in -> badresponse', () => res(200, { access_token: TOKEN }), 'badresponse']];
    for (const [name, mk, code] of cases) {
      const { b, out } = await callback({ relay: mk });
      check('relay: ' + name, !out.ok && out.error === code && b.AI.state() === 'off', JSON.stringify(out));
    }
    const { b } = await signInFixture(); b.routes.push(() => { throw new Error('x'); });
    const ne = await b.F.exchange('a.b.c').catch(() => ({ ok: false, error: 'thrown' }));
    check('relay: network failure resolves to an error', !ne.ok);
  }

  /* ---------- the relay worker ---------- */
  {
    const src = fs.readFileSync(path.join(root, 'tools/wif-relay/worker.js'), 'utf8').replace('export default', 'module.exports =');
    const mod = { exports: null }; new Function('module', 'Response', 'Request', 'fetch', 'AbortSignal', src)(mod, Response, Request, (...a) => upstream(...a), AbortSignal);
    const W = mod.exports;
    let sent = null, upstreamRes = null;
    function upstream(url, init) { sent = { url, init, body: JSON.parse(init.body) }; return Promise.resolve(upstreamRes()); }
    const env = { ALLOWED_ORIGINS: 'https://app.acme.test, https://other.test', FEDERATION_RULE_ID: 'fdrl_pinned', ORGANIZATION_ID: 'org-pinned', WORKSPACE_ID: 'wrkspc_pinned' };
    const A = jwt({ sub: 'x' });
    const post = (body, origin, extra) => new Request('https://relay.test/', Object.assign({ method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, origin === null ? {} : { origin: origin || 'https://app.acme.test' }), body: typeof body === 'string' ? body : JSON.stringify(body) }, extra));
    upstreamRes = () => new Response(JSON.stringify({ access_token: TOKEN, token_type: 'Bearer', expires_in: 900, scope: 'workspace:inference', refresh_token: 'LEAK', account: { email: 'x' } }), { status: 200 });
    let r = await W.fetch(post({ assertion: A, federation_rule_id: 'fdrl_evil', organization_id: 'org-evil', workspace_id: 'wrkspc_evil', service_account_id: 'svac_evil' }), env);
    let j = await r.json();
    check('worker: forwards to /v1/oauth/token with the jwt-bearer grant', sent.url === 'https://api.anthropic.com/v1/oauth/token' && sent.body.grant_type === 'urn:ietf:params:oauth:grant-type:jwt-bearer' && sent.body.assertion === A);
    check('worker: client-supplied ids are ignored, env ids are used', sent.body.federation_rule_id === 'fdrl_pinned' && sent.body.organization_id === 'org-pinned' && sent.body.workspace_id === 'wrkspc_pinned' && !('service_account_id' in sent.body), JSON.stringify(sent.body));
    check('worker: returns only access_token, expires_in, token_type, scope', r.status === 200 && Object.keys(j).sort().join() === 'access_token,expires_in,scope,token_type' && j.access_token === TOKEN);
    check('worker: CORS header for the allowed origin only, no-store', r.headers.get('access-control-allow-origin') === 'https://app.acme.test' && r.headers.get('cache-control') === 'no-store');
    let p = await W.fetch(new Request('https://relay.test/', { method: 'OPTIONS', headers: { origin: 'https://other.test' } }), env);
    check('worker: preflight for an allowed origin', p.status === 204 && p.headers.get('access-control-allow-origin') === 'https://other.test' && /POST/.test(p.headers.get('access-control-allow-methods')) && /content-type/i.test(p.headers.get('access-control-allow-headers')));
    p = await W.fetch(new Request('https://relay.test/', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }), env);
    check('worker: preflight for another origin is refused without CORS headers', p.status === 403 && !p.headers.get('access-control-allow-origin'));
    r = await W.fetch(post({ assertion: A }, 'https://evil.test'), env);
    check('worker: POST from a disallowed origin is 403 and never reaches Anthropic', r.status === 403 && !r.headers.get('access-control-allow-origin'));
    sent = null; r = await W.fetch(post({ assertion: A }, null), env);
    check('worker: POST without Origin is refused', r.status === 403 && sent === null);
    r = await W.fetch(post({ assertion: 'not a jwt' }), env); check('worker: malformed assertion is 400', r.status === 400);
    r = await W.fetch(post('x'.repeat(20000)), env); check('worker: oversized body is 413', r.status === 413);
    r = await W.fetch(post('{bad'), env); check('worker: invalid JSON is 400', r.status === 400);
    r = await W.fetch(post({ assertion: A }, undefined, { headers: { origin: 'https://app.acme.test', 'content-type': 'text/plain' } }), env); check('worker: wrong content type is 415', r.status === 415);
    r = await W.fetch(new Request('https://relay.test/', { method: 'GET', headers: { origin: 'https://app.acme.test' } }), env); check('worker: GET is 405', r.status === 405);
    upstreamRes = () => new Response(JSON.stringify({ error: { message: 'secret internal reason' } }), { status: 401 });
    r = await W.fetch(post({ assertion: A }), env); const t = await r.text();
    check('worker: Anthropic denial becomes a plain 401 with no upstream detail', r.status === 401 && !/secret/.test(t) && /authentication_failed/.test(t));
    upstreamRes = () => new Response('boom', { status: 500 }); r = await W.fetch(post({ assertion: A }), env); check('worker: upstream 5xx is 502', r.status === 502);
    upstreamRes = () => new Response('{}', { status: 200 }); r = await W.fetch(post({ assertion: A }), env); check('worker: upstream without a token is 502', r.status === 502);
    r = await W.fetch(post({ assertion: A }), { ALLOWED_ORIGINS: 'https://app.acme.test' }); check('worker: unconfigured relay is 500', r.status === 500);
    r = await W.fetch(post({ assertion: A }), Object.assign({}, env, { RATE_LIMITER: { limit: async () => ({ success: false }) } })); check('worker: rate limiter binding is honoured (429)', r.status === 429);
  }

  console.log('\nauth-test: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
