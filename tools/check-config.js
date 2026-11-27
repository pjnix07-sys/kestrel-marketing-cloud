#!/usr/bin/env node
/* Checks that MC.CONFIG.federation (js/config.js) and the CSP in index.html agree. Independent of smoke and e2e.
   Usage: node tools/check-config.js [--discover] [--strict]
   --discover  fetch <issuer>/.well-known/openid-configuration and also check the token endpoint's origin
   --strict    exit 1 on any warning (default: warnings only, exit 0). Federation off (null) is always fine. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const DISCOVER = process.argv.includes('--discover'), STRICT = process.argv.includes('--strict');

function load() {
  const ctx = { window: {} }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8'), ctx, { filename: 'js/config.js' });
  return ctx.MC && ctx.MC.CONFIG ? ctx.MC.CONFIG.federation : null;
}
function cspConnect() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  if (!m) return null;
  const d = m[1].split(';').map(s => s.trim()).find(s => /^connect-src\b/.test(s));
  return d ? d.split(/\s+/).slice(1) : [];
}
function origin(u) { try { return new URL(u).origin; } catch (e) { return null; } }
function covered(src, o) { return src.includes(o) || src.includes('*'); }

(async () => {
  const warns = [];
  const f = load();
  if (!f) { console.log('federation: off (MC.CONFIG.federation is null). Nothing to check.'); return; }
  const need = ['issuer', 'clientId', 'redirectUri', 'relayUrl', 'federationRuleId', 'organizationId'];
  need.filter(k => !f[k]).forEach(k => warns.push('federation.' + k + ' is missing; the sign-in choice stays hidden until it is set.'));
  if (f.federationRuleId && !/^fdrl_/.test(f.federationRuleId)) warns.push('federationRuleId should start with fdrl_.');
  if (f.workspaceId && !/^wrkspc_/.test(f.workspaceId)) warns.push('workspaceId should start with wrkspc_.');
  for (const k of ['issuer', 'relayUrl', 'redirectUri']) if (f[k] && !/^https:\/\//.test(f[k]) && !/^http:\/\/localhost[:/]/.test(f[k])) warns.push(k + ' should be https.');
  const src = cspConnect();
  if (src === null) warns.push('index.html has no Content-Security-Policy meta tag.');
  else {
    const want = new Map();
    if (f.issuer) want.set(origin(f.issuer), 'IdP (discovery)');
    if (f.relayUrl) want.set(origin(f.relayUrl), 'relay');
    if (DISCOVER && f.issuer) {
      try {
        const d = await (await fetch(f.issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration')).json();
        if (d.token_endpoint) want.set(origin(d.token_endpoint), 'IdP token endpoint');
      } catch (e) { warns.push('could not fetch the discovery document: ' + e.message); }
    } else if (f.issuer) console.log('note: the IdP token endpoint can sit on another origin than the issuer; run with --discover to check it.');
    for (const [o, what] of want) if (o && !covered(src, o)) warns.push('connect-src is missing ' + o + ' (' + what + '). Add it to the CSP meta tag in index.html.');
    // the authorization endpoint is a page navigation, not a fetch: connect-src does not apply.
  }
  if (warns.length) { warns.forEach(w => console.log('WARN ' + w)); if (STRICT) process.exit(1); }
  else console.log('OK federation config and CSP agree.');
})();
