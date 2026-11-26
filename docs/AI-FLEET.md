# Marketing Cloud: the Haiku agent fleet (binding — §12, overrides earlier sections where they conflict)

The eight agents become real AI agents powered by Claude Haiku 5.5 (`claude-haiku-5-5`). The rule-based engine stays as the
world, the numbers, the guardrails and the offline fallback. Haiku does the judgment and the writing.

## 12.1 Principles

1. **Haiku decides, guardrails enforce.** Every AI decision becomes ordinary proposals and catalog actions, so guardrails,
   autopilot routing, undo, realized-impact measurement and the audit chain apply unchanged. Haiku never mutates state directly.
2. **Grounded, never invented numbers.** Numbers (forecasts, lifts, reach, budgets, impacts) come from the engine. Haiku chooses
   among engine-computed candidates, tunes them inside declared ranges, and writes the marketer-facing words. Any number Haiku
   writes must come from its context; the validator rejects actions outside allowed ranges.
3. **Always works.** No key, offline, timeout (8 s), refusal, invalid JSON or schema failure → the rule-based result is used,
   silently, for that run. The UI never breaks or blocks on the AI.
4. **Replay-safe.** Log results, not requests (§0 P7): Haiku's output is recorded in the logged action payload, so replay
   reproduces the world without calling the API.
5. **Fast.** `effort: "low"` for agent runs and inline UI tasks, structured outputs (`output_config.format` json_schema), one
   request per agent run, at most 3 concurrent requests, a cached deep-context prefix.

## 12.2 Files (all classic-script IIFEs per §2; no modules)

| File | Provides |
|---|---|
| `js/ai/client.js` | `MC.ai` — key storage, connection state, `MC.ai.call(opts) -> Promise<{ok, data?, error?, usage, ms}>`, concurrency queue, usage/cost meter, `MC.ai.subscribe(fn)` |
| `js/ai/context.js` | `MC.ai.context` — builds the deep context: stable cached prefix + per-call volatile snapshot |
| `js/ai/fleet.js` | `MC.ai.fleet` — per-agent prompts, response schemas, validation, and the bridge into the runtime |
| `js/ai/tasks.js` | `MC.ai.tasks` — on-demand tasks used by views: `writeVariants`, `briefFromText`, `segmentFromText`, `explain` |
| `js/views/connect.js` + `css/views/connect.css` | Connect panel (key flow, status, usage, disconnect) opened from the top bar |

The raw `fetch` client is deliberate: the binding contract (§10.1) forbids modules/imports and has no build step, so the
`@anthropic-ai/sdk` package cannot be loaded. Calls go to `https://api.anthropic.com/v1/messages` with headers
`x-api-key`, `anthropic-version: 2026-10-21`, `content-type: application/json`, `anthropic-dangerous-direct-browser-access: true`.
Request body: `model: "claude-haiku-5-5"`, `max_tokens` (agent runs 4000, inline tasks 2000), `output_config: {effort: "low",
format: {type: "json_schema", schema}}`, `system` as content blocks with `cache_control: {type: "ephemeral"}` on the last stable
block. No `temperature`/`top_p`/`top_k` (400 on this API version), no assistant prefill (400). Check `stop_reason` before reading
`content`: `refusal` and `max_tokens` → fallback. Read the JSON from the first `text` block (thinking blocks may precede it).
Errors: 401 → state `invalid` ("That key didn't work"); 401 whose message starts "CORS requests are not allowed" → state
`blocked` ("Your organization doesn't allow browser access"); 429 → honour `retry-after` once, then fallback; 5xx/network → fallback.

## 12.3 Connect flow (as close to one click as the platform allows)

Anthropic offers no OAuth sign-in for third-party websites, so the prototype uses the user's own API key, kept in this browser only.

1. Top-bar control: "Connect Claude" (one quiet button; a small status dot once connected).
2. The panel shows one primary button, **Create a key at Anthropic**, which opens `https://platform.claude.com/settings/keys` in a
   new tab, with a one-line hint: "Name it Marketing Cloud and pick a 7-day expiry."
3. When the tab regains focus the panel offers **Paste key** (one click, `navigator.clipboard.readText()`; falls back to a
   password field if clipboard access is denied). Keys are recognised by the `sk-ant-` prefix.
4. The key is verified with one tiny Haiku call (`max_tokens: 16`), then the panel shows "Connected · Haiku 5.5" and closes.
5. "Remember on this device" (default on) → `localStorage`; off → `sessionStorage`. **Disconnect** clears both.
6. Copy, shown once: "Your key stays in this browser and is sent only to Anthropic." Plus a usage line:
   "This session: 42 agent runs · about $0.03".

## 12.4 Deep context (`MC.ai.context`)

- **Stable prefix (cached, identical bytes every call, sorted keys):** the operating manual — who the marketer is, the Fernway
  brand book (voice, tone words, banned words, claims rules from `MC.copy`), product catalog summary, channel rules and limits,
  guardrail definitions with their labels, the action catalog the agents may emit (types, payload schemas, ranges), the eight
  agents' roles and how they hand work to each other, and the writing rules (plain marketer English; no ticks, seeds, digests or
  "simulation"; numbers only from context; dates as calendar dates).
- **Agent block:** the agent's role, params (with ranges), autonomy, cadence and its **track record** — its last 10 proposals
  with outcome (applied / auto / rejected / undone / realized vs expected). Agents learn from what the marketer rejected or undid.
- **Volatile snapshot (after the cache breakpoint):** today's date, goal status and the KPIs, the live campaigns (budget,
  pacing, per-variant and per-channel results, audience, schedule), segments, the last 24 h of the activity feed, open
  proposals, the agent's `observe()` output, and the rule engine's candidate drafts with ids `c0..cn`.
- Target size: stable prefix 6–12k tokens, snapshot ≤ 8k tokens. Truncate lists by recency/impact, never mid-object.

## 12.5 Agent runs

Runtime change (`runtime.js`): when `MC.ai.isOn()` and the agent's `aiMode` isn't `off`, `runAgent` still computes candidates
deterministically but, instead of creating proposals, records the run as `awaiting` and hands `{runId, agentId, tick, obs,
candidates}` to `MC.ai.fleet.enqueue`. Autopilot/suggest routing happens only when the verdict lands.

Haiku's response schema per run:
```
{ decisions: [{ candidate: "c0", verdict: "propose"|"skip", adjust?: {<param>: number}, title, why, confidence: 0..1 }],
  extra?: [{ kind, target, actions, title, why }],      // only agents whose role allows original actions (copy, scout, planner)
  insights: [{ title, body, severity: "info"|"warn"|"crit", entityId? }],
  summary }                                              // one sentence for the activity feed
```
`MC.ai.fleet` validates (known candidate ids, adjust within declared ranges, action types the agent may emit, copy passing
`MC.copy.check` with no `fail`), then dispatches one logged action `agent/aiRun {runId, agentId, decisions, extra, insights,
summary, model, ms}`. Its reducer calls the same proposal-creation path the rule engine uses (materiality, cooldown, dedupe,
guardrails, routing), with Haiku's title and why. Trace lines record what the agent saw, decided and why, in plain language.
If the verdict doesn't arrive within 8 s, or fails validation, the run completes with the rule-based drafts (`ai: "fallback"`).

Original work by agent: **Copy Drafter** writes the challenger variant itself (subject, preheader, body, CTA per channel limits);
**Segment Scout** names and explains segments and may propose rule trees over known attributes; **Campaign Planner** writes the
plan narrative and content; **Insight Analyst** writes the insight bodies and the weekly summary. Optimizer, Send-Time, Pacer and
Guard choose among, tune and explain engine candidates.

## 12.6 On-demand tasks (views)

| Where | Task | Fallback |
|---|---|---|
| Content Studio → Generate variants | `writeVariants(brief) -> VariantDraft[]` (3 variants, brand-checked) | `MC.copy.generate` |
| Campaigns → Planner | `briefFromText(text) -> Brief` then plan via `MC.planner.plan`; plan narrative from Haiku | rule tables |
| Audiences → Describe your audience | `segmentFromText(text) -> rule tree` validated by `MC.segments` | phrase lexicon parser |
| Proposal and insight detail | `explain(entity)` — "Ask why" follow-up in plain English | rule-based rationale |

All show a calm inline state ("Writing…") and never block the rest of the UI.

## 12.7 UI rules

- Attribution stays as §11.3: "Optimized by Send-Time Tuner, 2h ago". No "AI" badges, sparkles or model names in the main UI;
  the model name appears only in the Connect panel.
- Not connected: everything works on the rule-based agents; one quiet line on the Agents screen: "Connect Claude to let the
  agents reason and write with Haiku." No nagging banners.
- Design bans from the user (binding, all views): no glassmorphism (no `backdrop-filter`, no translucent frosted panels); no
  curved or rounded left-edge bars or accent stripes on buttons, banners, cards or rows.

## As implemented (fleet core: `js/ai/client.js`, `context.js`, `fleet.js`, `tasks.js`; runtime/catalog integration)

**`MC.ai` (client.js)**: `state()` → `'off'|'connecting'|'on'|'invalid'|'blocked'`; `isOn()`; `getState()` → `{state, message, remember, hasKey, model, modelLabel, usage, inFlight, queued}`;
`subscribe(fn) → unsubscribe` (fn gets `getState()`); `verifyKey(key) → Promise<{ok, state, error?}>` (one `max_tokens:16` call, stores nothing);
`connect(key, {remember=true}) → Promise<{ok, state, error?}>` (verify, then localStorage or sessionStorage under `mc.ai.key`); `setRemember(bool)`; `disconnect()` (clears both);
`restore()` runs at load. `isKeyLike(s)` (`sk-ant-` prefix), `keyHint()`, `KEY_URL`, `MODEL`, `MODEL_LABEL` ("Haiku 5.5"), `DATA_POLICY` (Connect panel copy).
`usage()` → `{calls, agentRuns, tasks, fallbacks, errors, input, output, cacheRead, cacheWrite, cost, ms}` at $0.10/$0.50 per MTok, cache reads 0.1×, writes 1.25×; `usageLine()` → "This session: 42 agent runs · about $0.03".
`call({system, user|messages, schema, maxTokens, effort='low', timeoutMs, kind}) → Promise<{ok, data?, error?, usage, ms}>` (never rejects; ≤ 3 in flight).
A 401 drops the key and sets `invalid` (or `blocked` for the CORS message); 429 honours `retry-after` once.

**Data policy**: `MC.ai.context.scrub` runs on everything sent; profile-level fields (`idx`, `members`, `sample`, names, emails, …) and long id lists become counts. Only aggregates leave the browser.

**World facts (logged, replay-safe)**: `ai/setEnabled {on}` (dispatched by the fleet when the connection changes; `off` completes every waiting run with its rule drafts),
`agent/setAiMode {id, aiMode:'auto'|'rules'}` (per-agent rules-only lock; default auto), `agent/aiRun {runId, agentId, decisions, extra, insights, summary, model, ms}` or `{runId, agentId, fallback:true, reason}`.
`world.ai = {on, pending:{runId: job}}` exists only after the first `ai/setEnabled`; with AI never connected the world and smoke output are unchanged.

**Runtime**: when `world.ai.on` and `agent.aiMode !== 'rules'`, `runAgent` records the run in `world.ai.pending`, sets `agent.aiAwait = runId` (the agent skips further runs until it lands) and,
for the live world only, calls `MC.ai.fleet.enqueue`. `MC.runtime.statusOf()` adds `awaiting:true, runId` while waiting; `MC.runtime.awaiting(world)` lists waiting runs.
The verdict goes through the same proposal path (materiality, cooldown, dedupe, guardrails, routing). Proposals from Haiku carry `ai:'haiku'`, `why`, `confidence`.
Every audit entry has `engine:'ai'|'rules'`; AI-path entries add `ai:'haiku'|'fallback'`, `landedTick`, `model`, `aiMs`, `summary`, `fallbackReason`.
Copy written by Haiku is always `mustQueue` (never auto-applied).

**`MC.ai.fleet`**: `enqueue(job)`, `validate(world, job, data, ground)`, `schemaFor(agentId)`, `tunables(agentId, draft)` / `applyAdjust` (Copy Drafter `share` within `challengerShare`),
`ROLES`, `DEADLINE_MS` (8000), `sync()`, `last` (`{runId, agentId, result, reason?|ms?}`).

**`MC.ai.tasks`** (always resolve; `source:'ai'|'rules'`, never shown as a badge):
`writeVariants(opts) → VariantDraft[]` (MC.copy.generate shape; also `MC.copy.generateAsync`), `briefFromText(text) → Brief + {narrative}` (§10.9 Brief, ready for `MC.planner.plan`),
`segmentFromText(text) → {rule, name, why, matched, ignored, confidence, count?}`, `explain(proposal|insight|id, question?) → {text}`.
