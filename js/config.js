/* Marketing Cloud - deployment configuration. Loaded before js/ai/client.js.
   MC.CONFIG.federation turns on "Sign in with <your company>" in the Connect panel (OIDC Authorization Code + PKCE in the browser,
   then a small relay trades the ID token for an Anthropic access token; see tools/wif-relay/README.md). It is off (null) by default.
   When you set it, also add the IdP and relay origins to connect-src in the CSP meta tag of index.html (run: node tools/check-config.js).

   MC.CONFIG.federation = {
     idpName: 'Acme SSO',                          // button label: "Sign in with Acme SSO"
     issuer: 'https://login.acme.example',         // OIDC issuer; discovery at <issuer>/.well-known/openid-configuration
     clientId: '…',                                // public (SPA) client, no secret
     scopes: 'openid',
     redirectUri: 'https://acme.github.io/marketing-cloud/index.html',   // exactly as registered at the IdP
     relayUrl: 'https://wif-relay.acme.workers.dev',
     federationRuleId: 'fdrl_…',
     organizationId: '00000000-0000-0000-0000-000000000000',
     workspaceId: 'wrkspc_…'                       // optional
   }; */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var C = MC.CONFIG = MC.CONFIG || {};
  if (C.federation === undefined) C.federation = null;
})();
