# WIF relay

A tiny Cloudflare Worker (no dependencies) that lets the static Marketing Cloud app use Anthropic Workload Identity Federation.

Why it exists: `POST https://api.anthropic.com/v1/oauth/token` (the federation token exchange) does not support browser CORS, so a browser cannot call it. `/v1/messages` does, so once the relay has traded an IdP ID token for an access token (`sk-ant-oat01-…`), the browser calls Anthropic directly with `Authorization: Bearer`.

```
browser --(OIDC code + PKCE)--> your IdP --> id_token
browser --(POST {assertion})--> relay --(jwt-bearer grant + pinned ids)--> api.anthropic.com/v1/oauth/token
browser <--{access_token, expires_in, token_type, scope}-- relay
browser --(Authorization: Bearer)--> api.anthropic.com/v1/messages
```

## Caveat, read first

Anthropic documents Workload Identity Federation for workload identities (CI jobs, services). Using end-user OIDC ID tokens from a browser sign-in is not documented and may be rejected, for example by audience, subject or claim checks. Test it with your organisation before you rely on it. Also note that every signed-in user acts as the rule's one service account: Anthropic sees the service account, not the person. Scope that account narrowly.

## 1. Anthropic Console

1. Add your IdP as an issuer. The issuer URL must match your IdP's `iss` claim; Anthropic finds the keys through JWKS discovery (`<issuer>/.well-known/openid-configuration`).
2. Create a federation rule on that issuer. Set the audience to your OIDC client id (the `aud` of the ID token) and add subject or claim matchers (for example an email domain or a group claim) so only the people you intend can match.
3. Create a service account in a workspace and give it only the `workspace:inference` scope. The rule maps matching tokens to this service account.
4. Set the token lifetime on the rule as short as is practical. The relay passes through the `expires_in` Anthropic returns; the app warns two minutes before expiry and offers renewal.
5. Note the rule id (`fdrl_…`), organization id (a UUID) and workspace id (`wrkspc_…`). Optionally the service account id (`svac_…`).

## 2. Identity provider

Register a single-page / public client (Authorization Code with PKCE, no client secret). Redirect URI: the exact URL of the deployed app, for example `https://your-org.github.io/marketing-cloud/index.html` (GitHub Pages URL). Allow the origin for CORS on the token endpoint (many IdPs call this "Web origins" or "Cross-origin resource sharing"), since the browser exchanges the code itself. Scope: `openid`. For silent renewal the IdP must honour `prompt=none`.

## 3. Deploy the relay

```
cd tools/wif-relay
# edit wrangler.toml: ALLOWED_ORIGINS, FEDERATION_RULE_ID, ORGANIZATION_ID, WORKSPACE_ID
npx wrangler deploy
```

Variables (all in `wrangler.toml` or the dashboard; none is a secret, but keep them out of public forks if you prefer):

| Name | Meaning |
|---|---|
| `ALLOWED_ORIGINS` | Comma list of exact origins allowed to call the relay (CORS and enforcement). |
| `FEDERATION_RULE_ID`, `ORGANIZATION_ID` | Pinned. Required. |
| `WORKSPACE_ID`, `SERVICE_ACCOUNT_ID` | Pinned. Optional. |
| `RATE_LIMITER` | Optional Workers Rate Limiting binding, keyed by client IP. |

The relay takes only `assertion` from the request. Any `federation_rule_id`, `organization_id`, `workspace_id` or `service_account_id` the client sends is ignored. It accepts POST with JSON up to 16 KB, answers preflight for allowed origins only, returns only `{access_token, expires_in, token_type, scope}`, maps every Anthropic denial to a plain `401 {"error":"authentication_failed"}`, and never logs tokens or bodies (do not turn on request-body logging in Workers).

Rate limiting: the exchange is cheap but is an open door to your service account for anyone who can obtain a valid ID token. Turn on the `RATE_LIMITER` binding (see `wrangler.toml`) or a Cloudflare rate-limiting rule on the route.

## 4. Point the app at it

Set `MC.CONFIG.federation` in `js/config.js` (see the comment there), then add the IdP origin, the IdP token endpoint origin if it differs, and the relay origin to `connect-src` in the CSP meta tag of `index.html`. Run `node tools/check-config.js` to see what is missing (add `--discover` to read the IdP's endpoints).
