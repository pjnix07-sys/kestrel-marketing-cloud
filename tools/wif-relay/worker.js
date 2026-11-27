/* WIF relay: a Cloudflare Worker (no dependencies) that trades an IdP-issued OIDC ID token for an Anthropic access token.
   Why it exists: POST https://api.anthropic.com/v1/oauth/token does not allow browser CORS, so the static app cannot call it.
   The relay pins the federation rule, organization and workspace (env), takes ONLY the assertion from the caller, and returns only
   {access_token, expires_in, token_type, scope}. It never logs tokens or request bodies.
   Env: ALLOWED_ORIGINS (comma list, exact origins), FEDERATION_RULE_ID, ORGANIZATION_ID, WORKSPACE_ID (optional), SERVICE_ACCOUNT_ID (optional),
        RATE_LIMITER (optional Workers rate limiting binding). */
const UPSTREAM = 'https://api.anthropic.com/v1/oauth/token';
const GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const MAX_BODY = 16 * 1024;        // a JWT is a few KB at most
const MAX_ASSERTION = 12 * 1024;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

function allowed(env) { return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean); }

function cors(origin) {
  return { 'access-control-allow-origin': origin, 'vary': 'Origin' };
}

function json(status, obj, origin, extra) {
  const h = Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, origin ? cors(origin) : { vary: 'Origin' }, extra || {});
  return new Response(JSON.stringify(obj), { status, headers: h });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const ok = !!origin && allowed(env).indexOf(origin) >= 0;

    if (request.method === 'OPTIONS') {
      if (!ok) return new Response(null, { status: 403, headers: { vary: 'Origin' } });
      return new Response(null, { status: 204, headers: Object.assign(cors(origin), {
        'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }) });
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, ok ? origin : '', { allow: 'POST, OPTIONS' });
    if (!ok) return json(403, { error: 'origin_not_allowed' }, '');
    if (!env.FEDERATION_RULE_ID || !env.ORGANIZATION_ID) return json(500, { error: 'relay_not_configured' }, origin);

    if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const r = await env.RATE_LIMITER.limit({ key: ip });
      if (r && r.success === false) return json(429, { error: 'rate_limited' }, origin, { 'retry-after': '60' });
    }

    if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json(415, { error: 'unsupported_media_type' }, origin);
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY) return json(413, { error: 'too_large' }, origin);
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'too_large' }, origin);

    let body;
    try { body = JSON.parse(text); } catch (e) { return json(400, { error: 'invalid_json' }, origin); }
    const assertion = body && body.assertion;
    if (typeof assertion !== 'string' || assertion.length > MAX_ASSERTION || !JWT_SHAPE.test(assertion)) return json(400, { error: 'invalid_assertion' }, origin);

    // Client-supplied ids are ignored on purpose: every caller gets exactly the rule configured here.
    const out = { grant_type: GRANT, assertion, federation_rule_id: env.FEDERATION_RULE_ID, organization_id: env.ORGANIZATION_ID };
    if (env.WORKSPACE_ID) out.workspace_id = env.WORKSPACE_ID;
    if (env.SERVICE_ACCOUNT_ID) out.service_account_id = env.SERVICE_ACCOUNT_ID;

    let res;
    try {
      res = await fetch(UPSTREAM, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(out), signal: AbortSignal.timeout(10000) });
    } catch (e) { return json(502, { error: 'upstream_unreachable' }, origin); }

    if (res.status === 429) return json(429, { error: 'rate_limited' }, origin, { 'retry-after': res.headers.get('retry-after') || '30' });
    // Anthropic answers denials with an opaque 401; pass on only the fact of denial, never the upstream body.
    if (res.status >= 400 && res.status < 500) return json(401, { error: 'authentication_failed' }, origin);
    if (!res.ok) return json(502, { error: 'upstream_error' }, origin);
    let j;
    try { j = await res.json(); } catch (e) { return json(502, { error: 'upstream_invalid' }, origin); }
    if (!j || typeof j.access_token !== 'string' || !(Number(j.expires_in) > 0)) return json(502, { error: 'upstream_invalid' }, origin);
    return json(200, { access_token: j.access_token, expires_in: Number(j.expires_in), token_type: j.token_type || 'Bearer', scope: j.scope || '' }, origin);
  }
};
