# Marketing Cloud

A marketing cloud you run by setting goals. You write the outcome you want in one sentence ("Win back 400 lapsed hikers before Dec 15 without discounting more than 15%"); agents plan it, build the audience, campaign and copy, run it, and ask you only for the decisions that are yours to make. Campaigns, audiences, content and results are all there to inspect and edit, but you rarely have to start from them. Everything an agent does goes through the same logged actions, guardrails and undo as a change you make by hand.

It is simple by default and deep on demand: each page leads with one plain sentence and one main action, and Settings → Detail level switches advanced figures and controls (intervals, methods, rule builders, run traces) from one click away to always open.

The sample workspace is Fernway Outfitters, an invented outdoor retailer with 6,000 generated customer profiles. Its data is as of today and moves in real time.

**Live:** https://pjnix07-sys.github.io/kestrel-marketing-cloud/

## Try this first

1. **Home** (top of the left rail) answers "how am I doing and what needs me": revenue from your goals, each goal's progress against its target, and the decisions waiting.
2. **Answer a decision.** The win-back goal has one: it says why, what it changes and the likely impact. Answer it and the work it was holding continues at once.
3. **Open the goal** (Goals in the rail). The plan shows each step, which agent did it and what it produced; Activity lists what happened. Type "skip SMS" in Steer and the plan changes.
4. **Set a new goal** with the + at the top of the rail. Try `Grow Trail runners by 300 sign-ups by Dec 20 with no SMS`. Agents plan it and start within seconds.
5. **Content** in the rail: in Compose, edit one message and see its email, SMS, push, social and web versions render from the same blocks. **Results** shows goals, revenue, channels and content angles as charts with hover detail and table views.

Hover any rail icon for its name; press `/` to search everything.

## How the agents work

Out of the box the agents run on rules. A deterministic planner turns a goal sentence into a plan from templates (win back, launch, event revenue, grow a segment, protect the list), and the eight specialists do the work with the same scoring code as the rest of the app. Nothing needs a key.

Connect Claude (plug icon in the rail) and the Planner plans free-text goals with Claude Haiku 5.5, and the specialists reason and write with it. You connect with your own Anthropic API key. It stays in this browser (localStorage if "Remember on this device" is on, otherwise sessionStorage) and is sent only to `api.anthropic.com`. If a call fails, times out or returns something that does not validate, that step falls back to the rules result.

Data policy: only aggregated campaign and audience numbers are sent. Individual customer records never leave the browser. Claude's output is recorded in the logged action payload, so replaying a session needs no API call.

## Run locally

It is a static site with no build step. Serve the repo root over HTTP (the boot worker needs `http:` or `https:`, so `file://` falls back to building on the main thread):

```
python3 -m http.server 8765
# or, on Windows: powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8765
```

Then open http://localhost:8765/.

## Tests

| Command | What it covers |
|---|---|
| `node tools/smoke.js 500` | Boots the world headless, advances 500 ticks, reports audit errors (should be 0). Run it twice and the output must match. |
| `node tools/missions-test.js` | Mission planning, steps, asks, steering and determinism. |
| `node tools/content-test.js` | Content model, renders, ledgers, intelligence selectors, content agents. |
| `node tools/agent-eval/run.js` | Offline eval of the Haiku bridge with stubbed model responses (normal and adversarial cases). |
| `node tools/auth-test.js` | Offline checks of the connection layer: headers, expiry, storage. |
| `NODE_PATH=$(npm root -g) node tools/e2e.js` | Playwright and Chromium suite against its own server. Fails if any request leaves localhost, except a stubbed `api.anthropic.com`. |
| `NODE_PATH=$(npm root -g) node tools/auth-e2e.js` | Browser test of the connect flow with Anthropic stubbed. |

## Layout

```
index.html          script load order (classic scripts, no modules); ?v= cache keys
css/                tokens.css, app.css, views/*.css
js/core/            world, catalog, sim, engine, missions, content, runtime, guardrails, replay, boot-worker
js/agents/          lead (orchestrator) and the eight specialists
js/ai/              Claude client, context builder, fleet bridge, inline tasks
js/ui/              component kit, charts, flow, agent UI
js/views/           mission (home), content, campaigns, audiences, analytics, console (Team), connect, tour
js/app.js           side rail, bottom bar (phones), Approvals, settings, router, boot
tools/              tests and the local server script
docs/               AGENTIC, CONTENT, AI-FLEET, DESIGN-DIRECTION, ARCHITECTURE, DEMO, FORENSICS
concepts/           design prototypes the direction was chosen from
vendor/             React 18, React DOM, htm, and their licences
assets/             favicon, mark, Schibsted Grotesk font
```

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The product rules are in [docs/AGENTIC.md](docs/AGENTIC.md) and [docs/DESIGN-DIRECTION.md](docs/DESIGN-DIRECTION.md); content is in [docs/CONTENT.md](docs/CONTENT.md) and the Claude bridge in [docs/AI-FLEET.md](docs/AI-FLEET.md). [docs/DEMO.md](docs/DEMO.md) is a five-minute walkthrough.

## Credits and licences

- React and React DOM (MIT), htm (Apache 2.0): bundled in `vendor/` with their licence files.
- Schibsted Grotesk: SIL Open Font License 1.1, see `assets/fonts/LICENSE.txt`.
- Fernway Outfitters, its customers and its numbers are invented. Any resemblance to a real company is accidental.
