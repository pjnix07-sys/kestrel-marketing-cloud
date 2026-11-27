#!/usr/bin/env node
/* Browser check of the Connect panel's token and company sign-in flows (Playwright + Chromium). Independent of tools/e2e.js.
   Usage: NODE_PATH=$(npm root -g) node tools/auth-e2e.js [--port 8871] [--out <dir for screenshots>]
   api.anthropic.com, a fake IdP (login.acme.test) and a fake relay (relay.acme.test) are served by page.route; nothing else leaves localhost.
   js/config.js and the CSP in index.html are rewritten in flight for the sign-in context, which is exactly what an operator does by hand. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), nodeCrypto = require('crypto');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { console.error('Cannot load playwright. Run with NODE_PATH=$(npm root -g).'); process.exit(2); }
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = +arg('port', 8871), OUT = arg('out', '/tmp/claude-0/auth-e2e-out'), ROOT = path.join(__dirname, '..');
const ORIGIN = 'http://localhost:' + PORT, BASE = ORIGIN + '/index.html';
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('not found'); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(r);
});

let pass = 0, fail = 0;
const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (detail || ''))); };
const TOKEN = 'sk-ant-oat01-' + 'Z'.repeat(40);
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const FED = { idpName: 'Acme SSO', issuer: 'https://login.acme.test', clientId: 'client-1', scopes: 'openid', redirectUri: BASE, relayUrl: 'https://relay.acme.test/exchange',
  federationRuleId: 'fdrl_abc', organizationId: '11111111-1111-1111-1111-111111111111', workspaceId: 'wrkspc_xyz' };

async function newPage(browser, federated) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const st = { anthropic: [], relay: [], idpToken: [], authorize: [], external: [], errors: [] };
  page.on('pageerror', e => st.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') st.errors.push(m.text()); });
  await ctx.route(u => u.hostname !== 'localhost', async route => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (status, obj) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(obj) });
    if (u.hostname === 'api.anthropic.com') {
      st.anthropic.push(req.headers());
      if (req.headers().authorization !== 'Bearer ' + TOKEN) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'Authentication failed' } });
      return json(200, { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 5, output_tokens: 2 } });
    }
    if (u.hostname === 'login.acme.test') {
      if (u.pathname.endsWith('openid-configuration')) return json(200, { issuer: FED.issuer, authorization_endpoint: FED.issuer + '/authorize', token_endpoint: FED.issuer + '/token' });
      if (u.pathname === '/authorize') {
        st.authorize.push(u.searchParams); st.nonce = u.searchParams.get('nonce');
        const back = new URL(u.searchParams.get('redirect_uri')); back.searchParams.set('code', 'code-123'); back.searchParams.set('state', u.searchParams.get('state'));
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Acme SSO</title><script>location.replace(' + JSON.stringify(back.toString()) + ')</script>' });
      }
      if (u.pathname === '/token') {
        st.idpToken.push(req.postData());
        const claims = { iss: FED.issuer, aud: 'client-1', exp: Math.floor(Date.now() / 1000) + 600, nonce: st.nonce, sub: 'user-1' };
        return json(200, { id_token: b64u({ alg: 'RS256' }) + '.' + b64u(claims) + '.sig' });
      }
    }
    if (u.hostname === 'relay.acme.test') {
      st.relay.push(JSON.parse(req.postData() || '{}'));
      return json(200, { access_token: TOKEN, token_type: 'Bearer', expires_in: 900, scope: 'workspace:inference' });
    }
    st.external.push(req.url()); return route.abort();
  });
  if (federated) {
    await ctx.route(u => u.origin === ORIGIN && u.pathname === '/js/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.MC=window.MC||{};MC.CONFIG=MC.CONFIG||{};MC.CONFIG.federation=' + JSON.stringify(FED) + ';' }));
    await ctx.route(u => u.origin === ORIGIN && u.pathname === '/index.html', async route => {
      let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      html = html.replace('connect-src \'self\' https://api.anthropic.com', 'connect-src \'self\' https://api.anthropic.com https://login.acme.test https://relay.acme.test');
      await route.fulfill({ contentType: 'text/html', body: html });
    });
  }
  return { ctx, page, st };
}
const open = async page => { await page.click('#app-connect-btn'); await page.waitForSelector('#connect-panel', { state: 'visible' }); };
const aiState = page => page.evaluate(() => MC.ai.state());
const waitState = (page, s, ms) => page.waitForFunction(x => MC.ai.state() === x, s, { timeout: ms || 8000 }).then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    /* ---------- paste a federated token ---------- */
    {
      {   // Individuals (no federation config): API key only, no choices shown at all.
        const p0 = await newPage(browser, false);
        await p0.page.goto(BASE); await p0.page.waitForSelector('#app-connect-btn');
        await open(p0.page);
        check('unconfigured: API key only (no sign-in or token choice)', (await p0.page.locator('#connect-mode-signin').count()) === 0 && (await p0.page.locator('#connect-mode-token').count()) === 0);
        await p0.ctx.close();
      }
      const { ctx, page, st } = await newPage(browser, true);
      await page.goto(BASE); await page.waitForSelector('#app-connect-btn');
      await open(page);
      await page.check('#connect-mode-token');
      check('token: form explains the source in one line', /Workload Identity Federation/.test(await page.innerText('#connect-panel')) && /ant auth print-credentials/.test(await page.innerText('#connect-panel')));
      await page.fill('#connect-token', 'sk-ant-api03-notatoken-123456');
      await page.click('#connect-token-submit');
      check('token: a non-token is refused in the panel', /doesn.t look like a federated access token/.test(await page.innerText('#connect-msg')));
      await page.fill('#connect-token', TOKEN);
      const inOneHour = new Date(Date.now() + 3600e3 - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
      await page.fill('#connect-expiry', inOneHour);
      await shot(page, 'token-form');
      await page.click('#connect-token-submit');
      check('token: verified and connected', await waitState(page, 'on'), 'state ' + await aiState(page));
      check('token: Authorization: Bearer sent, no x-api-key', st.anthropic.length > 0 && st.anthropic.every(h => h.authorization === 'Bearer ' + TOKEN && !h['x-api-key']), JSON.stringify(st.anthropic[0]));
      const s = await page.evaluate(() => ({ l: Object.keys(localStorage).map(k => localStorage.getItem(k)).join('|'), t: sessionStorage.getItem('mc.ai.token') }));
      check('token: stored in sessionStorage only', /sk-ant-oat01/.test(s.t || '') && !/sk-ant-oat/.test(s.l), JSON.stringify(Object.keys(s)));
      await page.waitForSelector('#connect-panel', { state: 'visible' });
      check('token: top bar and panel say connected, expiry shown', /connected/i.test(await page.getAttribute('#app-connect-btn', 'aria-label')));
      await page.waitForTimeout(1600);
      if (!(await page.locator('#connect-panel').isVisible())) await open(page);
      check('token: panel shows the token kind and expiry time', /federated access token/.test(await page.innerText('#connect-kind')) && /Valid until/.test(await page.innerText('#connect-kind')));
      await shot(page, 'token-connected');
      // expiring: the panel offers renewal
      await page.evaluate(t => MC.ai.connectToken(t, { expiresAt: Date.now() + 100e3 }), TOKEN);
      check('expiring: state becomes expiring at T-120s and agents stay on', await waitState(page, 'expiring') && await page.evaluate(() => MC.ai.isOn()));
      await page.waitForSelector('#connect-renew', { timeout: 4000 }).catch(() => {});
      check('expiring: the panel offers renewal', (await page.locator('#connect-renew').count()) === 1 && /expires at/i.test(await page.innerText('#connect-panel')), await page.innerText('#connect-panel'));
      await shot(page, 'token-expiring');
      // expired: agents fall back to rules, no errors
      await page.evaluate(t => MC.ai.connectToken(t, { expiresAt: Date.now() + 1500 }), TOKEN);
      check('expired: state becomes expired and Claude is off', await waitState(page, 'expired', 6000) && !(await page.evaluate(() => MC.ai.isOn())));
      await page.waitForTimeout(300);
      check('expired: the panel says so and offers a new token', /expired/i.test(await page.innerText('#connect-msg')) && (await page.locator('#connect-token').count()) === 1, await page.innerText('#connect-panel'));
      check('expired: token gone from storage', await page.evaluate(() => sessionStorage.getItem('mc.ai.token') === null));
      await shot(page, 'token-expired');
      check('token: nothing left localhost except the stubs, no console errors', st.external.length === 0 && st.errors.length === 0, st.external.concat(st.errors).join(' / '));
      await ctx.close();
    }

    /* ---------- company sign-in ---------- */
    {
      const { ctx, page, st } = await newPage(browser, true);
      await page.goto(BASE + '#/agents'); await page.waitForSelector('#app-connect-btn');
      await open(page);
      check('signin: the choice appears first and is selected', await page.locator('#connect-mode-signin').isChecked() && (await page.locator('#connect-signin').innerText()).includes('Sign in with Acme SSO'));
      await shot(page, 'signin-panel');
      const hash0 = new URL(page.url()).hash;
      await page.click('#connect-signin');
      for (let i = 0; i < 100 && !st.relay.length; i++) await page.waitForTimeout(100);     // the page leaves, then comes back
      await page.waitForSelector('#app-connect-btn');
      check('signin: connected after the round trip', await waitState(page, 'on', 12000), 'state ' + await aiState(page));
      const q = st.authorize[0];
      check('signin: authorization request used code + S256 + openid + the redirect URI', q && q.get('response_type') === 'code' && q.get('code_challenge_method') === 'S256' && q.get('scope') === 'openid' && q.get('redirect_uri') === BASE && !q.has('prompt'));
      check('signin: PKCE verifier sent to the IdP token endpoint', st.idpToken.length === 1 && /code_verifier=[A-Za-z0-9_-]{64}/.test(st.idpToken[0]));
      check('signin: relay got the assertion and the configured ids', st.relay.length === 1 && st.relay[0].federation_rule_id === 'fdrl_abc' && st.relay[0].organization_id === FED.organizationId && st.relay[0].workspace_id === 'wrkspc_xyz' && st.relay[0].assertion.split('.').length === 3);
      check('signin: Anthropic saw the federated Bearer token only', st.anthropic.length > 0 && st.anthropic.every(h => h.authorization === 'Bearer ' + TOKEN && !h['x-api-key']));
      const url = new URL(page.url());
      check('signin: URL cleaned (no code/state), route kept', !url.search && url.hash === hash0 && !!hash0, page.url());
      const s = await page.evaluate(() => ({ l: Object.keys(localStorage).map(k => localStorage.getItem(k)).filter(v => /sk-ant-oat/.test(v)).length, t: JSON.parse(sessionStorage.getItem('mc.ai.token') || 'null'), p: sessionStorage.getItem('mc.fed.pending') }));
      check('signin: token in sessionStorage (federated), nothing in localStorage, pending record cleared', s.l === 0 && s.t && s.t.source === 'federated' && s.p === null, JSON.stringify(s));
      await open(page);
      check('signin: the panel names the IdP', /Acme SSO/.test(await page.innerText('#connect-kind')));
      await shot(page, 'signin-connected');
      // a forged callback is rejected
      await page.evaluate(() => MC.ai.disconnect());
      await page.goto(BASE + '?code=forged&state=nope'); await page.waitForSelector('#app-connect-btn');
      await open(page);
      check('signin: a callback with a wrong state is rejected with a message', /rejected/i.test(await page.innerText('#connect-msg')) && (await aiState(page)) !== 'on');
      check('signin: the forged URL was cleaned too', !new URL(page.url()).search);
      check('signin: nothing left localhost except the stubs, no console errors', st.external.length === 0 && st.errors.filter(e => !/Failed to load resource/.test(e)).length === 0, st.external.concat(st.errors).join(' / '));
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log('\nauth-e2e: ' + pass + ' pass, ' + fail + ' fail  (screenshots in ' + OUT + ')');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
