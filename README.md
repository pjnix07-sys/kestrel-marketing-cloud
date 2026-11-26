# Marketing Cloud

Marketing Cloud is a prototype of an agentic marketing platform. A marketer plans campaigns, writes content, builds audiences and reads analytics, while eight agents watch the numbers and propose or make changes. You choose how much each agent may do on its own, and every change can be traced and undone.

All data is synthetic. The sample company is Fernway Outfitters, a fictional outdoor gear brand with 6,000 generated customers and 60 days of history.

**Live demo:** https://pjnix07-sys.github.io/kestrel-marketing-cloud/

## What to try first

1. Open the Command Center. Read the KPI strip, then "What changed", which lists what the agents have done.
2. Open "Approvals" in the top bar and approve or dismiss one proposal. Each shows a reason, an expected impact range, the guardrails it passed and the exact changes.
3. Undo something an agent did on its own from "What changed".
4. In Campaigns, describe a campaign in a sentence and let the Campaign Planner draft it.
5. In Agents, change an agent between Off, Suggest and Autopilot.

A scripted five-minute walkthrough is in [docs/DEMO.md](docs/DEMO.md).

## How the agents work

The app runs on rules by default, with no network calls. Eight agents (Variant Optimizer, Send-Time Tuner, Budget Pacer, Fatigue Guard, Insight Analyst, Copy Drafter, Segment Scout, Campaign Planner) compute candidate changes from the sample data. Each agent is set to Off, Suggest (queues proposals for approval) or Autopilot (acts inside its guardrails). Fatigue Guard and Variant Optimizer start on Autopilot; the others start on Suggest, and Campaign Planner only offers Off or Suggest.

**Connect Claude** (top bar) lets the agents and some writing tools use Claude Haiku 5.5 with your own Anthropic API key. Haiku writes the wording and picks among the options the rule engine computed. It cannot change state directly, and its proposals go through the same guardrails and approvals. If the key is missing, the call times out (8 seconds) or the reply is invalid, the rule-based result is used for that run.

Data policy: only aggregated campaign and audience numbers are sent to Anthropic, never individual customer records. Your key stays in this browser (localStorage if "Remember on this device" is on, otherwise sessionStorage) and is sent only to api.anthropic.com. Disconnect clears it.

## Run locally

There is no build step. Serve the repository root with any static server.

```
python3 -m http.server 8000
```

Then open http://localhost:8000/. On Windows without Node or Python:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1
```

This serves http://localhost:8765/ (use `-Port` to change it).

## Tests

- `node tools/smoke.js [ticks]` loads the core and agent scripts in Node, boots the sample world and advances it. No browser needed.
- `NODE_PATH=$(npm root -g) node tools/e2e.js [--port 8870] [--only boot,home,...]` runs a Playwright and Chromium suite against its own server. It fails if any request leaves localhost, except api.anthropic.com, which it stubs.

## Project layout

```
index.html          script load order (classic scripts, no modules)
css/                tokens.css, app.css, views/*.css
js/core/            world, actions, simulation, engine, runtime, guardrails, replay
js/agents/          the eight agents
js/ai/              Claude client, context builder, fleet bridge, inline tasks
js/ui/              component kit, charts, flow, agent UI
js/views/           home, campaigns, content, audiences, analytics, console (Agents), connect
js/app.js           shell, navigation, approvals drawer
tools/              smoke.js, e2e.js, serve.ps1
docs/               ARCHITECTURE.md, DEMO.md, CONTRACT.md, AI-FLEET.md, api/, critique/, review/
vendor/             React 18, React DOM, htm, and their licences
assets/             favicon, mark, Schibsted Grotesk font
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, and [docs/CONTRACT.md](docs/CONTRACT.md) for the original design contract.

## Credits and licences

- React and React DOM (MIT), htm (Apache 2.0): bundled in `vendor/` with their licence files.
- Schibsted Grotesk: SIL Open Font License 1.1, see `assets/fonts/LICENSE.txt`.
- Fernway Outfitters, its customers and its numbers are invented. Any resemblance to a real company is accidental.
