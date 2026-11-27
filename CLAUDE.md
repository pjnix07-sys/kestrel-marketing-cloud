# Marketing Cloud: working rules for Claude

Read docs/FORENSICS.md once: it explains why the first build missed and the rules below exist.

## Product thesis (check every change against it)
Agentic first, traditional marketing cloud last. You hand a team of agents an outcome; you see them plan it, do it,
hand work to each other and ask you only for real decisions; campaigns, audiences and copy are things they make.
Binding specs: docs/AGENTIC.md (product and mission model), docs/DESIGN-DIRECTION.md (visual language).

## Rules
1. Thesis first: restate the change's effect on the thesis in one sentence before building; challenge inherited plans.
2. Experience before architecture: prototype the screen (live, on real state) and look at it before building systems.
3. Show, don't count: every update includes a screenshot or capture of the real app, then test results.
4. Ten-second test: a cold viewer must be able to say what the agents are doing and why.
5. Surface tensions between instructions; ask instead of silently picking one.
6. Reviews always include "what would make this unmistakably agentic and memorable?", not only realism/correctness.
7. The lead session owns the whole experience; workers build pieces.
8. Incumbent marketing clouds are a capability checklist, never the navigation or primary surface.
9. Live software, not theatre: no play/pause/replay, playheads, countdowns or delays added to be watched.
10. Still banned visually: glassmorphism/backdrop-filter, curved left-edge stripes, decorative gradients, sparkle/AI
    icons, emoji, KPI-tile walls, sidebar-of-objects navigation.

## Engineering
Static, no build: classic-script IIFEs on window.MC, React 18 + htm from vendor/, asset URLs carry ?v=MC.BUILD (bump
MC.BUILD and every ?v= in index.html together on each deploy). All state changes are logged catalog actions; keep
replay deterministic. Checks: `node tools/smoke.js 500` (0 audit errors, identical across two runs),
`node tools/missions-test.js`, `node tools/agent-eval/run.js`, `NODE_PATH=$(npm root -g) node tools/e2e.js`.
