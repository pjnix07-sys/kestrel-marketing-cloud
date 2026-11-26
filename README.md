# Marketing Cloud

A prototype agentic marketing cloud, inspired by Salesforce Marketing Cloud Next. A marketer plans campaigns, composes content, segments audiences and reads predictive analytics while eight deterministic agents run in the background, proposing and applying optimizations.

All data is synthetic. The sample tenant, Fernway Outfitters, is a fictional outdoor gear brand.

## How it works

- **No build step.** Plain static files: `index.html`, `css/`, and classic scripts under `js/`. React 18 and htm load from public CDNs.
- **Deterministic agents.** No LLM calls. Every random choice comes from a seeded generator, and time comes from a simulation clock (1 tick = 1 simulated hour). Replaying the seed and your action log reproduces the same state, and the Agents screen can verify that.
- **Autonomy you control.** Each agent runs Off, Suggest (queues proposals for approval) or Autopilot (acts within its guardrails). Every run is logged with digests of what it saw and what it did, and autopilot actions can be undone.

The full design is in [docs/CONTRACT.md](docs/CONTRACT.md).

## Run locally

Any static file server works. On Windows without Node or Python:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1
```

Then open http://localhost:8765/.
