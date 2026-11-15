# core-c API reference (as implemented)

Files: `js/core/sim.js`, `runtime.js`, `engine.js`, `replay.js`. No CSS. Each function works on the world it is given and never reads the store, except where this page says otherwise (engine, verify). Lookups into other builders' namespaces happen at call time.

## sim.js (`MC.sim`)
- `CONST` holds every calibration constant from §5.2 and §10.7, including unit costs, intercepts, offer lift and discount, caps (600 per campaign and 1,500 global per tick, 16 transitions), the 3-hour send window, CPM/CTR, ROAS ranges and the organic hazard. `HOUR_SHAPE` is a Float64Array(24) that sums to 1.
- `season(d)` applies the weekend bump plus the Black Friday peak.
- `latentFor(world, variant) -> {qo, qc, qv}` draws from `fork(seed,'variant',vid)` in the order εo, εc, εv. It uses `MC.copy.score` and `MC.copy.BANK_STATS` when they are present; without them the values are the noise draws alone.
- `curvesFor(world, campaign) -> {'cid|ch': {A, B}}` covers paid channels. It draws ROAS, then the B factor, from `fork(seed,'curve',cid,ch)`. It writes `world.latent.curves` and returns the same map.
- `dailyBudget(world, cid, ch, d?) -> $` is the remaining channel budget divided by the days left. It is 0 unless the campaign is live and the channel is unpaused.
- `enroll(world, cid, tick) -> count` enrolls (segmentId ∪ include) − suppress where `step === -1`. It assigns the control cohort with `fnv1a(id+'|'+cid) % 100 < holdoutPct`, rebuilds `order` and bumps `enroll`.
- `dayRoll(world, d)` runs §10.6 step 2 in contract order:
  - It pushes the day entry and decays fatigue, clears the `sent7` slot and decays the hour histograms.
  - It updates visits30 using `fork(seed,'day',d)`.
  - On Mondays it calls `models.fitPropensity(world, modelState.coef)` and copies the returned coefficients back. Every day it calls `models.scoreProfiles`.
  - It recounts segments (new objects with the same `ver`, and `countHist` keeps the last 8 values), then runs dynamic entry and re-orders live and paused campaigns.
  - It rebuilds `world._organic`.
- `step(world, t) -> {sends, events}` runs §10.6 steps 3–7: status transitions, owned sends, paid channels, organic orders and bumps.
  - Status transitions go through `catalog.apply` with origin `sim`. They add `campaign` feed items ("… went live with N people in its journey", "… completed at 92% of goal").
  - Pending proposals whose campaign is completed or removed expire through `MC.runtime.expire`.
- Extras: `goalValue(world, c)`, `campaignOfProposal(world, p)`, `audienceBits(world, c)`, `_prodInfo`, `_dayEntry`.
- Caches: `world._organic` and `enroll[cid]._ads`. Both use `_` keys, so they are excluded from digests and rebuilt lazily.

## runtime.js (`MC.runtime`)
- Registry functions:
  - `register(def)` stores a normalized copy with defaults for name, order, cadence, autonomy, params, materiality, `autopilotMaxRisk` and horizon.
  - `defs()` returns the definitions sorted by order. `def(id)` returns one.
  - Also exported: `defaultParams(def)` and `newAgentEntity(def)`.
- `ensureAgents(world)` adds an entity at its defaults for every registered agent missing from `world.agents`. Boot and replay both call it through `MC.engine.prepare`.
- `observeView(world)` returns a shallow copy without `latent`.
- `statusOf(world, id) -> {state:'off'|'paused'|'queued'|'running', lastRun, nextRun, cadence, phase}`.
- `runAgent(world, id, t, reason)` follows §10.9 exactly:
  - Setup: rng `fork(seed,'agent:'+id,t)`, then materiality, then cooldown, then dedupe or supersede. Proposal ids are `${id}-${t}-${k}`.
  - Guardrails: `MC.guardrails.evaluate(world, proposal, def+{guardrails: def ∪ consent, protectDrafts, targetFresh, holdout})`. `baseVer` covers the entities the actions target.
  - Routing: autopilot applies only when the proposal is not `mustQueue`, no blocking guardrail fails and risk ≤ `autopilotMaxRisk`. Otherwise the reason is "Suggested" or "Needs you: …".
  - Afterwards: insights are deduped by key per day, the chained audit entry is written and one feed item is added.
  - Return value: the audit entry `{id:'run-<id>-<t>', agentId, tick, reason, mode, inDigest, outDigest, prev, chain, proposals[], insights[], dispatched:[{type, entity, payloadDigest, applied, proposalId}], trace[], error, _ms}`.
  - Audit entries are stored newest first and capped at 1,500. `audit.head` holds the chain.
- `runDue(world, t)` runs engine step 8: it expires proposals (`expiresTick ≤ t`), realizes impact (`appliedTick + horizon === t`), then runs each due or `runRequested` agent in `def.order`.
- `apply(world, pid, origin)` serves the approve path:
  - It substitutes tmpIds, applies each action through `catalog.apply` and prepends each returned `inverse`.
  - It sets `appliedTick`, `postVer`, `inverse` and `created`, and for extend-campaign it sets `horizon = newEnd − t`.
  - It updates `stats.applied`, or `stats.auto` on autopilot, plus `stats.expected` for `$` impacts.
  - If an action fails, it reverts the applied ones and closes the proposal as `stale`.
- `undoCheck(world, pid) -> {ok, reason?, by?, tick?}`. The reason uses the §10.9 copy.
- `expire(world, pid, reason, t)`. `realize(world, p)` returns `{delta, lo, hi, tick, method:'did'|'diff'|'model'|'window'}` per §10.8.
- `preview(agentId, input, world?)` is pure. It calls `def.preview(input, ctx)` with `fork(seed,'preview',id,tick)` and returns `{proposals, trace, plan}`.

## engine.js (`MC.engine`)
- Constants: `SPEEDS {pause:0,'1x':1200,'4x':300,'16x':75}`, `SPEED_KEYS`, and `PHASES` (profiles, history, scores, agents, each with a label).
- `advance(world)` runs one tick: `meta` is copy-on-write with `tick+1`, then `dayRoll` (at h=0), then `sim.step`, then `runtime.runDue`.
- `tickOnce()` advances the live world inside one `store.batch` and writes `checkpoints[t] = digestWorld(w).state` at each day roll.
  - If a tick throws, the engine pauses and shows a crit toast.
  - It sets `lastTickMs` and `lastError`.
- The scheduler is a `setTimeout` chain that fires exactly one tick per fire. The next delay is `max(0, interval − elapsed)`. It runs regardless of view.
- `setSpeed(key)` also writes `MC.uiStore` `{speed}`, so a view can use `useUi(s => s.speed)`. Other controls: `getSpeed()`, `step(n)` (1–168 ticks, one notify) and `isBooted()`. `subscribe(fn)` fires on speed changes and after every tick.
- `boot({seed, onPhase, speed?}) -> Promise<world>` generates the world in slices through `MC.data.generateSteps`, or through `generate` as a fallback.
  - It calls `onPhase(id, {index, total, label})` for each phase.
  - Then it calls `prepare`, then `store.init`, and starts at 1×. It is idempotent.
- `restart(seed?, onPhase?)` pauses, regenerates, clears checkpoints and toasts, resets stale `uiStore.focus` ids and resumes at 1×.
- Also exported: `prepare(world)` and `generateWorld(seed, onPhase)`.

## replay.js (`MC.replay`, `MC.dev`)
- `digestWorld(w) -> {state, audit, parts:{profiles, latent, metrics, enroll, entities, log}}` follows §10.11 exactly.
- `run({seed, log, toTick, onProgress, chunk=20, checkpoints?}) -> Promise<world>` follows the §10.11 loop and yields with `setTimeout(0)`.
  - It sets `w._firstMismatch` (the first checkpoint tick that differs, or null).
  - It sets `w._diverged` (`{tick, seq, type, error}` when a logged action fails during replay).
- `verify({onProgress, chunk}) -> Promise<{match, tick, ms, live, replay, actions, checkpoints, firstDivergence?, replayError?}>`.
  - It pauses, sets `uiStore.verifying {done,total}`, restores the previous speed and clears `verifying` when it finishes.
  - `firstDivergence` is either `{tick, agentId, auditId, live, replay, checkpoint}` or `{tick, part, live, replay, checkpoint}`.
  - The last result is kept at `MC.replay.lastResult`. Concurrent calls share one run.
- `MC.dev.selfTest({seed?, onProgress?, skipGoals?}) -> Promise<rows>`. Each row is `{id, label, status:'pass'|'warn'|'fail', ok, value, detail}`, and the ids are generate, segments, ticks, determinism, scan, contract and goals. Every check runs on fresh copies of the world, never the live one.
