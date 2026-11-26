# Docs review (team docs)

**Verdict.** The old README described a no-LLM app that loads React from CDNs, which no longer matches the code (Haiku bridge, vendored libraries). I rewrote it and added a demo script with a first-run spec and an architecture doc. Facts were checked against the code; nothing was run in a browser.

## Findings

1. **High, README.md (old):** claimed "No LLM calls" and CDN React. Fixed: states rules by default, Connect Claude, data policy, vendored React.
2. **Medium, docs/CONTRACT.md:** still says "Kestrel", names an 8765 serve default and predates §12; ARCHITECTURE.md links it only for design rules. Fix: add a one-line pointer to AI-FLEET.md at its top.
3. **Medium, no guided first-run in the app:** grep for tour/onboarding finds nothing. Spec is in docs/DEMO.md part 2; not built.
4. **Low, tools/agent-eval:** does not exist, so the README does not mention it.
5. **Low, DEMO.md step 2:45:** the planner brief field (`#brief-describe`) was not exercised; confirm the sentence yields a plan on rules only.
6. **Low, repo name vs product name:** repo is kestrel-marketing-cloud, UI says Marketing Cloud. Left as is.

## Assumptions

- The Planner works on rules when no key is set (campaigns.js says it degrades to a plain draft).
- Licences: htm Apache 2.0 and React MIT from the files in vendor/.
- Dismissing a proposal triggers a cooldown (CONTRACT P4), used in the demo copy.

## Quick wins

- Add the AI-FLEET pointer to CONTRACT.md.
- Run through DEMO.md once and adjust timings.
- Build the first-run behind a `firstRun` flag in `mc.ui.v1`.
