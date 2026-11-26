# Security review

**Verdict.** For a static, synthetic-data, bring-your-own-key prototype the design is sound. I found no `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `javascript:` or user-controlled URL sinks. The key goes only to `api.anthropic.com`, and Haiku output reaches the world only through a validated, logged `agent/aiRun`. The real gaps are the missing CSP (the key sits in `localStorage` by default), role gates that are skipped or not checked in several places, and a few approval/undo logic errors. Assumptions: the persona switcher is a demo of governance, not authentication; I did not run the app and read the code only.

## Findings, ranked

1. **Medium: no CSP, and the key persists in `localStorage` by default.** `index.html` has no CSP. `js/ai/client.js:78-82` and `:238` default to "Remember on this device" (`localStorage`), so any script XSS reads `mc.ai.key`. The app has no XSS sink today, but nothing enforces that. Fix: add the CSP below, and default `remember` to `false` (`sessionStorage`) in `client.js:32` and `:238` and in `connect.js:rs`.
2. **Medium: the `settings` permission is defined but never enforced.** `catalog.js:27` grants `settings` to admin only, but no `roleErr(ctx,'settings',…)` exists. `guardrails/update` (`:1736`, including daily spend cap, frequency caps, claims registry and brand rules) and the `agent/set*` actions (`:1393-1439`, including Autopilot) can be changed by Analyst or Content lead. Fix: add the role check to those validators.
3. **Medium: `proposal/undo` has no role gate** (`catalog.js:1636`). A read-only Analyst can undo an applied change, and either signer can undo a two-person high-risk change alone. The feed text is hard-coded "You undid" with no `by`. Fix: `roleErr(ctx,'approve','undo changes')`, require the high-risk rule on undo, and attribute `by`.
4. **Medium: `approveMany` skips high-risk proposals silently** (`catalog.js:1589-1603`). Validate passes if any one id is approvable. If every selected id is high-risk, nothing happens, yet a log entry and the "You approved N changes" text are produced. Fix: make validate fail when no id is approvable, and say how many were skipped.
5. **Medium: the two-person rule collapses when there is no actor.** The `ctx.by &&` guards (`:1558`, `:1566`, `:1603`) mean a null persona approves high-risk changes alone. Replay also uses null for old log entries, which is correct for replay but means the rule is advisory. Separately, the persona is a self-service `<select>` stored in `localStorage` (`app.js:95-103`), so one person can be both approvers. Fix: label this as a demo control in the UI, and make the live path reject a null actor.
6. **Low: Haiku prose is only number-grounded.** `fleet.js:99` (`cleanText`) blocks meta words and ungrounded numbers, but not URLs, phone numbers or imperative text. User-entered notes, campaign names and segment text feed the prompt (`tasks.js:60,128,160,202`), so an injected sentence can end up in a proposal rationale, which the approver relies on. It renders as escaped React text, so this is only a persuasion risk. Fix: strip URLs and phone numbers from `cleanText` output.
7. **Low: the reducer trusts `p.extra.risk` and `p.extra.mustQueue`** (`runtime.js:723-724`). `fleet.js` only sets `risk` to medium and `mustQueue` to true, so this is safe today. But a logged payload with `risk:'low'` would auto-apply under Autopilot. Fix: let the reducer only raise risk, never lower it.
8. **Low: rejected stored keys stay in storage.** `AI.restore` (`client.js:274`) leaves an invalid or blocked key in `localStorage` and re-sends it on every load. Fix: call `clearKey()` on `invalid`.
9. **Low: GitHub Pages cannot send response headers.** The meta CSP cannot carry `frame-ancestors`, `report-uri` or `sandbox`. Clickjacking is low-impact here. Add `<meta name="referrer" content="no-referrer">`. The outbound `rel="noopener noreferrer"` link in `connect.js:98` is already correct.

## Proposed CSP

Place it as the first `<meta>` after `charset` in `index.html`:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://api.anthropic.com; base-uri 'none'; form-action 'none'; object-src 'none'">
```

Checked against the code:
- `index.html` has no inline `<script>`, `<style>` or `style=` attributes. All 40+ scripts are `vendor/` or `js/` on the same origin.
- React and htm do not use `eval` or `new Function` (grep: none in `vendor/`).
- Every `style=` in the JSX is an object. React applies those through the CSSOM, which `style-src 'self'` allows. There is no `setAttribute('style')`.
- The only fonts and `url()` references are the local `woff2` and the SVG favicon; the favicon is covered by `img-src 'self'`. `data:` is kept as slack.
- The app makes no same-origin `fetch`. `'self'` in `connect-src` is only for the `tools/e2e.js` stub.
- The `platform.claude.com` link is a navigation, so the CSP does not affect it.

Re-run `tools/e2e.js` and check the console for CSP violations after adding it.

## Quick wins
- Add the CSP above.
- Default the key to `sessionStorage`.
- Enforce `settings` in `guardrails/update` and `agent/set*`.
- Add an `approve` role check to `proposal/undo`.
- Make `approveMany` fail when nothing is approvable.
- Clear the stored key when verification returns `invalid`.
- Strip URLs from Haiku text in `cleanText`.
