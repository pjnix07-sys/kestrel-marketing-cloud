# Kestrel Marketing Cloud: Architecture Proposal (Marketer-Workflow Lens)

This is a binding contract for 9 parallel builders. It covers the whole system and goes deepest on what the marketer sees and does.

The inspiration vendor's product names, logos and trademarks never appear in UI copy, identifiers, CSS classes or comments that reach the page.

---

## 0. The marketer contract: principles every builder enforces

| # | Principle | Mechanism |
|---|---|---|
| P1 | One screen answers three questions: how are we doing, what changed, and what needs me. | Command Center: KPI strip, Forecast, What changed, Needs you. |
| P2 | Agents speak marketer, not math. | Every proposal has a title, **Why** (with numbers), **Expected impact** (a range), **Guardrails**, the exact **Changes** diff, and Approve / Dismiss / Undo. |
| P3 | Agents add; they never overwrite authored work. | Agents never edit text or rules a person wrote, and never touch `draft` campaigns (`protectDrafts` is locked on). New copy arrives as a new variant. New audiences arrive as new segments. |
| P4 | Quiet by default. | Materiality thresholds. At most one toast per tick. A newer proposal on the same target **supersedes** the old one instead of stacking. Cooldown after a rejection. "Needs you" holds only actionable items; insights go to the feed. |
| P5 | Never clobber. | Drafts live in component state. A store change under an open editor shows a **conflict chip** rather than replacing the draft. Lists freeze while the marketer is scrolled or focused and show "N new". Sort order is frozen while a table has focus. |
| P6 | Every number explains itself. | Predictions have a "Why" popover with model contributions. Agent actions show expected vs realized impact, measured against a 10% static control cohort. |
| P7 | Provable. | Seed + logged user actions produce the same world. "Verify determinism" replays it headlessly. **Log results, not requests**: a payload carries the generated plan or variant, never a call to regenerate it. |

---

## 1. Feature map

| Inspiration capability | Kestrel area / surface | Deterministic mechanism | Responsible agent(s) |
|---|---|---|---|
| Campaign creation from a brief | Campaigns → **Planner** (Brief + Plan draft) | Rule tables (goal → journey template, channel priors) + segment EV ranking + equal-marginal budget split + `MC.copy.generate` + response-curve forecast | **Campaign Planner** (`planner`): on-demand preview plus a weekly "next campaign" draft |
| Segment intelligence / NL segmentation | Audiences → **Describe your audience**, Builder, Suggested segments | Phrase lexicon parser → rule tree. Compiled predicates over columns. Greedy depth-2 lift splits. | **Segment Scout** (`scout`) |
| Content generation and adaptation | Content Studio → **Generate variants**, previews, checks | Seeded phrase banks by tone/product/offer, channel adapters (length limits), linear engagement model, brand checker | **Copy Drafter** (`copy`) |
| Journey decisioning / personalization | Campaigns → detail → **Journey** | Step graph with decision nodes (opened / clicked / purchased / best channel / propensity). Per-profile best hour when the send hour is `adaptive`. | **Send-Time Tuner** (`sendtime`); journey engine in `sim` |
| Paid media / performance optimization | Campaign detail → Overview leaderboard, Budget tab | Beta-Bernoulli Thompson allocation with min-sample pause rules. Saturating response curves with equal-marginal-ROAS reallocation. | **Variant Optimizer** (`optimizer`), **Budget Pacer** (`pacer`) |
| Marketing intelligence / predictive analytics | Analytics, Command Center forecast | Holt + weekly indices with prediction intervals, EWMA z-score anomalies, last-touch/linear attribution, what-if on curves, template narratives | **Insight Analyst** (`analyst`) |
| Unified profiles + predictive attributes | Audiences → Profiles, attribute picker "Predictions" group | Struct-of-arrays profile store. Daily rescoring: logistic propensity, churn, LTV, best channel (Beta-smoothed), best hour (circular histogram). | Core daily job (`sim` day-roll); used by every agent |
| Trust layer: approvals, guardrails | Approvals drawer, Agents → Guardrails / Audit & replay | Autonomy Off / Suggest / Autopilot, guardrail registry, inverse actions (undo), FNV-1a digests, chained audit, replay verify | Runtime (core); **Fatigue Guard** (`guard`) for consent and frequency |
| Capabilities as agent tools | Agents → run trace "Actions called" | Typed action catalog. Each agent declares `emits` (its tool whitelist). The trace lists each dispatched action. | All agents |

---

## 2. Files, ownership, load order

```
index.html                     ui      page fragment (no doctype/html/head/body)
css/tokens.css                 ui      palette + type + spacing tokens, light/dark
css/app.css                    ui      shell, kit (k-*), charts (ch-*), utilities
css/views/home.css             home    scoped under .v-home
css/views/campaigns.css        campaigns  .v-campaigns
css/views/content.css          content    .v-content
css/views/audiences.css        audiences  .v-audiences
css/views/analytics.css        analytics  .v-analytics
css/views/console.css          console    .v-agents
js/core/namespace.js           core    MC root, MC.html, buckets, MC.contract
js/core/util.js                core    MC.util, MC.fmt
js/core/time.js                core    MC.time (tick <-> calendar, no Date in logic)
js/core/rng.js                 core    MC.rng (sfc32 + forks)
js/core/catalog.js             core    MC.catalog (action types, reducers, inverses)
js/core/store.js               core    MC.store, MC.uiStore, MC.nav, MC.hooks (data hooks)
js/core/models.js              core    MC.models (scores, forecast, anomalies, curves, bandit, attribution)
js/core/segments.js            core    MC.segments (attrs, compile, evaluate, parse, traits, overlap)
js/core/copy.js                core    MC.copy (phrase banks, generate, features, score, check, render)
js/core/data.js                core    MC.data.generate (synthetic world + 60-day history)
js/core/guardrails.js          core    MC.guardrails
js/core/sim.js                 core    MC.sim (tick step, journey engine, outcomes, metrics)
js/core/select.js              core    MC.select (memoized derived selectors shared by views)
js/core/runtime.js             core    MC.runtime (agent registry, scheduling, proposals, audit, undo, realize)
js/core/engine.js              core    MC.engine (boot, wall-clock scheduler, tickOnce)
js/core/replay.js              core    MC.replay, MC.dev.selfTest
js/ui/icons.js                 ui      MC.icons + <Icon>
js/ui/kit.js                   ui      MC.ui.* components + MC.hooks.useWidth/useReducedMotion
js/ui/charts.js                ui      MC.charts.* (SVG)
js/ui/flow.js                  ui      MC.charts.FlowDiagram, MC.charts.Gantt
js/ui/agent-ui.js              ui      AgentChip, ProposalCard, GuardrailList, DiffTable, TraceView, AgentPulse, ImpactBadge
js/agents/optimizer.js         agents  Variant Optimizer
js/agents/sendtime.js          agents  Send-Time Tuner
js/agents/pacer.js             agents  Budget Pacer
js/agents/guard.js             agents  Fatigue Guard
js/agents/scout.js             agents  Segment Scout
js/agents/copy.js              agents  Copy Drafter
js/agents/analyst.js           agents  Insight Analyst
js/agents/planner.js           agents  Campaign Planner (+ MC.planner tables)
js/views/home.js               home       MC.views.home
js/views/campaigns.js          campaigns  MC.views.campaigns
js/views/content.js            content    MC.views.content
js/views/audiences.js          audiences  MC.views.audiences
js/views/analytics.js          analytics  MC.views.analytics
js/views/console.js            console    MC.views.agents
js/app.js                      ui      shell, router, top bar, drawer, toasts, theme, mount
```

**index.html (exact order)**

```html
<title>Kestrel Marketing Cloud</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/app.css">
<link rel="stylesheet" href="css/views/home.css"> … campaigns, content, audiences, analytics, console
<div id="app"><div class="app-boot" role="status">Generating the Fernway sample world…</div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js"></script>
<!-- core --> namespace, util, time, rng, catalog, store, models, segments, copy, data, guardrails, sim, select, runtime, engine, replay
<!-- ui -->   icons, kit, charts, flow, agent-ui
<!-- agents --> optimizer, sendtime, pacer, guard, scout, copy, analyst, planner
<!-- views --> home, campaigns, content, audiences, analytics, console
<script src="js/app.js"></script>
```

**File template (all files):**

```js
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  …
})();
```

Rule: cross-builder lookups happen at call or render time, never at load time. Example: `MC.ui.Button` is looked up inside the render function.

---

## 3. MC namespace API

```js
// ── namespace.js
MC.VERSION = '1.0.0'; MC.SEED = 20261107;
MC.html = htm.bind(React.createElement);
MC.views = {}; MC.agents = {}; MC.ui = {}; MC.charts = {}; MC.icons = {}; MC.hooks = {}; MC.dev = {};
MC.contract.require(path) -> any            // throws "MC.segments.evaluate missing (owner: core)"
MC.contract.check() -> { missing: string[] } // app.js shows a dev panel only if non-empty
MC.contract.REQUIRED = [ '...every public path in this section...' ]

// ── util.js
MC.util.fnv1a(str, h = 0x811c9dc5) -> uint32
MC.util.fnvBytes(typedArray, h) -> uint32           // hashes underlying bytes
MC.util.canon(v) -> string   // sorted keys; ints verbatim; floats toPrecision(12) trimmed; -0→0;
                             // typed arrays → "#"+hex(fnvBytes); undefined dropped; keys starting "_" dropped
MC.util.digest(v) -> 'xxxxxxxx'
MC.util.clamp(x,lo,hi) lerp(a,b,t) sigmoid(x) logit(p) round(x,dp)
MC.util.sum(a) mean(a) sd(a) quantile(sortedA,q) argmax(a)
MC.util.stableSort(arr, cmp)                        // ties broken by .id
MC.util.shallowEqual(a,b) arrayEqual(a,b)
MC.util.wilson(k, n, z = 1.96) -> [lo, hi]
MC.util.memo(fn, keyFn) -> fn                        // single-slot cache by key string
MC.fmt.money(n, {compact, cents}) // "$1,860" | "$412k"
MC.fmt.num(n, {compact})          // "6,000" | "12.4k"
MC.fmt.pct(p, dp = 1)             // "4.1%"
MC.fmt.pp(d)                      // "+0.6 pp"
MC.fmt.delta(r)                   // "+6.2%"
MC.fmt.ratio(x)                   // "5.8×"
MC.fmt.range(lo, hi, f)           // "$371k–$455k"
MC.fmt.date(tick) "Sat, Nov 7"   time(tick) "14:00"   stamp(tick) "Nov 7 · 14:00"
MC.fmt.rel(fromTick, nowTick) "3h ago" | "in 4h" | "2d ago"   hour(h) "7 pm"

// ── time.js  (tick 0 = Sat 2026-11-07 00:00; 1 tick = 1 h; history days are negative)
MC.time.dayOf(t) hourOf(t) dow(t) /*0=Sun; dow(0)=6*/ tickOf(day,hour)
MC.time.calendar(day) -> { y, m, d, dow, label }    // pure arithmetic, no Date
MC.time.EVENTS = [{day:19,label:'Thanksgiving'},{day:20,label:'Black Friday'},{day:23,label:'Cyber Monday'}]

// ── rng.js
MC.rng.create(seed) -> Rng                // sfc32, state from splitmix32(seed) ×4, 12 warm-up draws
MC.rng.fork(seed, ...keys) -> Rng         // create(seed ^ fnv1a(keys.join('|')))
// Rng: next() int(n) range(a,b) normal(mu,sd) gamma(k) beta(a,b) bernoulli(p) binomial(n,p)
//      poisson(lam) lognormal(mu,sd) pick(arr) weighted(ws)->idx shuffle(arr)->copy sampleIdx(n,k)->Int32Array

// ── catalog.js
MC.catalog.define(type, {
  by: ['user'|'agent'|'sim'], label, entity(p) -> {kind,id},
  validate(world,p) -> null|string, reduce(world,p,meta) -> world,
  inverse(worldBefore,p) -> action|null, describe(world,p) -> string })
MC.catalog.get(type)  MC.catalog.reduce(world, action, meta) -> world  MC.catalog.inverse(world, action)

// ── store.js
MC.store.init(world)                      // engine only
MC.store.getState() -> World
MC.store.subscribe(fn) -> unsub
MC.store.dispatch({type,payload}) -> {ok} | {ok:false, error}  // USER path: validate(by:'user'), stamp {seq,tick},
                                          // append world.log, reduce, ONE microtask notify
MC.store.applyInternal(action, by)        // sim/runtime only, never logged
MC.store.batch(fn)                        // nested-safe; single notify at end
MC.store.bump(key)                        // world.rev[key]++ for mutable columns
MC.uiStore.getState() set(patch|fn) subscribe(fn)   // ephemeral; theme+route persisted via try/catch localStorage
MC.nav.go(route, focusPatch?)  MC.nav.route()       // sets uiStore.focus then location.hash = '#'+route
MC.hooks.useSelect(sel, eq = Object.is)   // useSyncExternalStore + cached snapshot (returns last if eq)
MC.hooks.useShallow(sel)  useUi(sel, eq)  useTick()
MC.hooks.useDraft(source, {eq, onCommit}) -> { value, set, dirty, commit(), reset(),
                                               conflict, theirs, takeTheirs(), keepMine() }
MC.hooks.useFrozen(list, {key:'id', freeze}) -> { items, pending, reveal() }
MC.hooks.useDebounced(value, ms)
// (ui/kit.js adds) MC.hooks.useWidth(ref) -> px ; MC.hooks.useReducedMotion() -> bool

// ── data.js
MC.data.generate(seed) -> World           // < 300 ms; also exposed as generateSteps(seed) for sliced boot
MC.data.CATEGORIES, PRODUCTS, REGIONS, STATES, CHANNELS = ['email','sms','push','social','web'], TIERS

// ── models.js
MC.models.fitPropensity(world, warmCoef?) -> coef[]
MC.models.scoreProfiles(world)            // fills prop/churn/ltv/bestCh/bestHr columns; bump('profiles')
MC.models.holt(series, {alpha, beta, season:7, h}) -> {fitted, forecast:[{mean,lo80,hi80,lo95,hi95}], sigma}
MC.models.goalProbability(actualToDate, forecastPts, goal) -> p
MC.models.ewma(series, {lambda:0.2, z:3, minN:7}) -> [{i, value, expected, z}]
MC.models.fitResponse(points[{spend,revenue}]) -> {A, B, r2, sd}
MC.models.response(c, s)  MC.models.marginal(c, s)
MC.models.probBest(arms[{a,b}], rng, draws) -> number[]
MC.models.attribution(world, {model:'last'|'linear', fromDay, toDay, campaignIds}) -> {byChannel, byCampaign}
MC.models.unsubRisk(world, i, ch) -> p

// ── segments.js
MC.segments.ATTRS -> [{key,label,group:'Profile'|'Behavior'|'Predictions',type:'num'|'cat'|'bool',ops,values?,unit?,fmt}]
MC.segments.compile(rule) -> (i) => bool
MC.segments.evaluate(world, rule) -> { bits:Uint8Array, count, ms }   // < 10 ms @ 6000
MC.segments.traits(world, bits) -> { reach:{email,sms,push,ads}, hist:{prop,churn,ltv}, region, tier, bestCh, bestHr:number[24], sample:int[5] }
MC.segments.overlap(world, ids) -> { ids, counts:number[][], pct:number[][] }
MC.segments.parse(text) -> { rule, matched:[{phrase, attr, label, cond}], ignored:string[], confidence }
MC.segments.describe(rule) -> "Last order more than 120 days ago and state is WA, OR or ID"
MC.segments.validate(rule) -> string[]
MC.segments.members(world, segmentId) -> bits    // cached per day (rev.segCounts)

// ── copy.js
MC.copy.TONES = ['practical','adventurous','warm','urgent']; MC.copy.OFFERS = ['none','freeship','pct15','pct25','gift']
MC.copy.LIMITS = { subject:60, preheader:90, sms:160, pushTitle:40, pushBody:120, socialText:125, socialHeadline:40 }
MC.copy.generate({channel, tone, productId, offer, count, locks:{field:value}, seedKey}, seed) -> VariantDraft[]
MC.copy.features(variant) -> {len, hasNumber, personal, urgency, question, ctaStrength, offerStrength, image, grade, caps, toneFit}
MC.copy.score(variant, ctx?) -> { score:0-100, predOpen, predClick, contributions:[{label, delta}] }
MC.copy.check(variant, brand) -> [{id,label,status:'pass'|'warn'|'fail',detail,fix?:{field,value}}]
MC.copy.render(variant, world, profileIdx) -> filled fields

// ── guardrails.js
MC.guardrails.DEFAULTS; MC.guardrails.define(id, {label, blocking, fn(world, proposal, def) -> {pass, detail}})
MC.guardrails.evaluate(world, proposal, def) -> [{id,label,pass,detail,blocking}]

// ── sim.js
MC.sim.step(world, tick) -> { sends, events }     // mutates columns/metrics; entity changes via applyInternal
MC.sim.dayRoll(world, day)

// ── select.js  (memoized on world.rev.* + args; shared by all views)
MC.select.kpis(w) campaignRows(w) campaignStats(w,cid) variantStats(w,cid,ch) series(w,f) forecast(w,f)
MC.select.funnel(w,f) channelCompare(w,f) attribution(w,f) liftVsControl(w,cid) agentMarkers(w,f)
MC.select.openProposals(w) proposalsFor(w,entityId) feed(w,{kinds}) agentRoster(w) agentImpact(w) segmentRows(w)

// ── runtime.js
MC.runtime.register(def)  defs()  def(id)
MC.runtime.runDue(world, tick)              // engine only
MC.runtime.preview(agentId, input) -> { proposals, trace }   // pure; e.g. planner draft
MC.runtime.observeView(world) -> world without .latent
MC.runtime.statusOf(world, id) -> { state:'running'|'paused'|'off'|'queued', lastRun, nextRun }

// ── engine.js
MC.engine.SPEEDS = { pause:0, '1x':1200, '4x':300, '16x':75 }   // ms per tick
MC.engine.boot({seed, onPhase}) -> Promise   // phases: profiles → history → scores → agents; starts at 1×
MC.engine.setSpeed(key) getSpeed() step(n = 1) restart(seed?) tickOnce() lastTickMs

// ── replay.js
MC.replay.digestWorld(w) -> { state, audit, parts:{profiles, metrics, entities, log} }
MC.replay.run({seed, log, toTick, onProgress, chunk:20}) -> Promise<World>
MC.replay.verify({onProgress}) -> Promise<{ match, tick, ms, live, replay, firstDivergence? }>
MC.dev.selfTest() -> Promise<rows>          // gen time, seg eval time, tick time, verify, contract
```

---

## 4. State shape and action catalog

```js
World = {
  meta: { seed, tick, tenant:'Fernway Outfitters', sample:true, day0:-60, monthGoal:{revenue:140000} },
  seq: 0,                                      // id counter (reducers only)
  rev: { profiles, metrics, enroll, segCounts },// bump when mutable columns change
  catalog: { categories:[{id:'hike',label:'Hiking'},'camp','climb','run','apparel'], products:[{id,name,cat,price,margin}] /*24*/ },
  profiles: {                                  // struct-of-arrays, n = 6000
    n, id:string[] /*'P-00123'*/, name:string[] /*'Maya R.'*/, state:Uint8, region:Uint8, age:Uint8, tenure:Int16,
    tier:Uint8 /*0 Base,1 Trailhead,2 Summit,3 Peak*/, cat:Uint8, aff:Float32(n*5), orders:Uint16, spend:Float32,
    aov:Float32, lastOrder:Int16 /*day*/, visits30:Uint8, consent:Uint8 /*E1 S2 P4 A8*/, unsub:Uint8,
    fatigue:Float32, sent7:Uint8(n*3*7), supUntil:Int32(n*3), eng:Uint16(n*3*3) /*sent,open,click × email,sms,push*/,
    openHr:Uint8(n*24), touchC:Int16(n*8), touchCh:Uint8(n*8), touchT:Int32(n*8), tPtr:Uint8,
    prop:Float32, churn:Float32, ltv:Float32, bestCh:Uint8, bestHr:Uint8 },
  latent: { profiles:{ p0:Float32, eng:Float32, cf:Float32(n*5), ph:Uint8, priceSens:Float32 },
            variants:{ [vid]:{ qo, qc, qv } }, curves:{ ['cid|ch']:{ A, B } } },      // hidden from agents & views
  segments: { byId:{ [id]: { id, name, rule, author:'user'|'agent:scout', createdTick, ver, count, countDay } }, order:[] },
  campaigns: { byId:{ [id]: Campaign }, order:[] },
  variants: { byId:{ [id]: Variant } },
  enroll: { [cid]: { step:Int16(n)/*-1 none*/, due:Int32(n), ctl:Uint8(n), flags:Uint8(n)/*1 open 2 click 4 buy*/, order:Int32Array /*by prop desc, daily*/, entered, exited } },
  metrics: { days:[ { tot:Fact, c:{ [cid]:{ tot, trt, ctl, ch:{[ch]:Fact}, v:{[vid]:Fact}, attrLast:{[ch]:$}, attrLin:{[ch]:$} } } } ],
             hours:{ [cid]:{ [ch]: Float64Array(48) /*sends[24],opens[24], decayed 0.9/day*/ } } },
  // Fact = Float64Array(9): [sent, delivered, opens, clicks, conv, revenue, cost, unsubs, impressions]
  agents: { byId:{ [id]: { id, status:'active'|'paused', autonomy:'off'|'suggest'|'autopilot', cadence, params,
            lastRunTick, runRequested, cooldowns:{[key]:untilTick},
            stats:{ runs, proposed, applied, auto, rejected, undone, expired, superseded, expected, realized } } }, order:[] },
  proposals: { byId:{ [id]: Proposal }, order:[] /*newest first*/, open:[] },
  feed: FeedItem[],          // newest first, cap 400
  insights: Insight[],       // cap 100
  audit: { entries: AuditEntry[], head: 'xxxxxxxx' },
  guardrails: { freqCap:{email:4,sms:2,push:5} /*per 7d*/, quiet:{start:21,end:8,channels:['sms','push']},
                maxShiftPct:20, minSample:500, maxDailySpend:2500, holdoutPct:10, protectDrafts:true /*locked*/,
                brand:{ banned:['cheap','guaranteed','act now','!!!'], smsOptOut:true, maxSubject:60, maxGrade:8, noAllCaps:true } },
  log: [ { seq, tick, type, payload } ]   // USER actions only = replay input
}

Campaign = { id, name, status:'draft'|'scheduled'|'live'|'paused'|'completed', ver,
  goal:{ type:'revenue'|'conversions'|'reactivation'|'engagement'|'launch', target }, startTick, endTick,
  segmentId, suppress:[segmentId], channels:[], productFocus, tone, offer,
  budget:{ total, byChannel:{[ch]:$} }, alloc:{ [ch]:{ [vid]:share } }, initialAlloc /*for control cohort*/,
  sendHour:{ [ch]: 0..23 | 'adaptive' }, journey:{ steps:[Step] }, holdoutPct, createdBy, brief, createdTick }
Step = { id, type:'entry'|'send'|'wait'|'decide'|'exit', label, channel?, waitH?, next?,
         rule?:{ kind:'opened'|'clicked'|'purchased'|'consent'|'propensityAbove'|'bestChannel', value? },
         yes?, no?, branches?:{email,sms,push} }
Variant = { id, campaignId, channel, name:'A', status:'draft'|'live'|'paused'|'retired', ver, author:'user'|'agent:copy',
  fields:{ subject, preheader, headline, body, cta, link, imageId, alt, sms, pushTitle, pushBody, socialText, socialHeadline },
  tone, offer, productId, createdTick, predicted:{ score, open, click } }
Proposal = { id:'optimizer-312-0', agentId, tick, kind, target:{kind,id,channel?}, title, rationale, evidence:[{label,value}],
  impact:{ metric, delta, lo, hi, unit:'$'|'#'|'pp', horizonDays, confidence }, risk:'low'|'medium'|'high',
  guardrails:[…], actions:[{type,payload}], inverse:[…]|null, diff:[{label,before,after}], baseVer:{[entityId]:ver},
  status:'pending'|'applied'|'auto'|'rejected'|'expired'|'superseded'|'undone'|'stale', reason, decidedTick, expiresTick,
  realized:{ delta, lo, hi, tick } | null }
FeedItem = { id, tick, kind:'agent-applied'|'agent-proposed'|'approved'|'rejected'|'undone'|'anomaly'|'insight'|'campaign'|'user',
             agentId?, proposalId?, entity?, text, tone:'agent'|'neutral'|'good'|'warn'|'crit' }
Insight = { id, tick, kind:'anomaly'|'goal-risk'|'roi'|'pacing', title, body, entity?, severity, dismissed, key }
AuditEntry = { id:'run-optimizer-312', agentId, tick, inDigest, outDigest, prev, chain, proposals:[ids],
               dispatched:[{type, entity, payloadDigest}], trace:[{step:'observe'|'decide'|'guardrails'|'apply', text, rows?}], _ms }
```

**Action catalog.** Every action is logged when the user dispatches it. Agent actions run inside proposals and are not logged, because replay regenerates them.

| Type | Payload | By | Inverse |
|---|---|---|---|
| `campaign/create` | `{campaign, variants[]}` (full plan) | user, agent:planner | `campaign/remove` |
| `campaign/update` | `{id, patch}` (name, goal, dates, tone, offer, productFocus, brief) | user | prior patch |
| `campaign/setStatus` | `{id, status}` | user; sim (scheduled→live→completed) | prior status |
| `campaign/setSegment` | `{id, segmentId}` | user, agent:scout | prior |
| `campaign/setJourney` | `{id, steps}` | user | prior steps |
| `campaign/setAlloc` | `{id, channel, alloc}` | user, agent:optimizer, agent:copy | prior alloc |
| `campaign/setSendHour` | `{id, channel, hour\|'adaptive'}` | user, agent:sendtime | prior |
| `campaign/setBudget` | `{id, byChannel}` (total preserved for agents) | user, agent:pacer | prior |
| `campaign/setEnd` | `{id, endTick}` | user, agent:analyst | prior |
| `campaign/suppress` | `{id, segmentId, on}` | user, agent:guard | toggle |
| `campaign/remove` | `{id}` (draft only) | user | create(snapshot) |
| `variant/create` | `{variant}` | user, agent:copy | `variant/setStatus retired` |
| `variant/update` | `{id, fields}` (user only; live → "save anyway" path) | user | prior fields |
| `variant/setStatus` | `{id, status}` | user, agent:optimizer | prior (+ alloc restore) |
| `segment/create` / `update` / `remove` | `{segment}` / `{id, name?, rule?}` / `{id}` | user, agent:scout (create) | remove / prior / create |
| `profiles/suppress` | `{channel, idx[], untilTick, campaignId}` | agent:guard, user | `profiles/release {channel, idx[], prev[]}` |
| `profiles/release` | `{channel, idx[]}` | user | suppress(prev) |
| `agent/setAutonomy` / `setStatus` / `setCadence` / `setParams` / `resetParams` | `{id, …}` (validated against def ranges) | user | n/a |
| `agent/runNow` | `{id}`: sets `runRequested`, runs at the next tick | user | n/a |
| `proposal/approve` | `{id}`: re-checks guardrails and `baseVer`; stale → status `stale` | user | via `undo` |
| `proposal/approveMany` | `{ids}` | user | n/a |
| `proposal/reject` | `{id, reason:'not-now'\|'wrong'\|'other'}`: cooldown 24h / 7d / 24h | user | n/a |
| `proposal/undo` | `{id}`: allowed only if every target `ver` still equals its post-apply ver | user | n/a |
| `guardrails/update` | `{patch}` (`protectDrafts` and consent immutable) | user | n/a |
| `insight/dismiss` | `{id}` | user | n/a |

Sim and runtime internals are never logged: `sim/status`, `sim/enroll`, `sim/rescore`, `runtime/propose`, `runtime/autoApply`, `runtime/expire`, `runtime/supersede`, `runtime/realize`, `runtime/recordRun`.

**Replay ordering.** A user action dispatched while the clock shows tick T is stamped `T`.

- Live run: process tick T, then the user acts, then process tick T+1.
- Replay: for t = 1..N, apply log entries stamped t−1 in `seq` order, then `tickOnce()`. After the loop, apply entries stamped N.

---

## 5. Simulation and model math

### 5.1 Tick pipeline (`engine.tickOnce`, inside `store.batch`)

1. Set `t += 1`, `h = hourOf(t)`, `d = dayOf(t)`.
2. **Day roll** (when `h == 0`):
   - Fatigue: `F *= 0.8`.
   - Clear the `sent7[d mod 7]` slot. Hour counters ×0.9.
   - `scoreProfiles` and segment counts refresh (`rev.segCounts`).
   - Dynamic-entry enrollment for live campaigns.
   - Per-campaign `enroll.order` = enrolled profiles sorted by `prop` descending (ties by index).
   - Propensity refit (warm start) when `dow == 0`.
3. **Status:** `scheduled` with `startTick <= t` becomes `live` (enroll segment minus suppressions; control cohort = `fnv1a(pid+'|'+cid) % 100 < holdoutPct`). `live` with `endTick <= t` becomes `completed` (feed item: "completed at {pct} of goal").
4. **Owned channels (journey engine):** for each live campaign in `order`, iterate `enroll.order`.
   - Profiles with `due <= t` advance through `wait` and `decide` steps instantly.
   - A `send` step fires only if all of these hold: consent bit set; not unsubscribed; treatment cohort not suppressed (`supUntil`); `sent7` sum < `freqCap`; not quiet hours (sms/push); the hour matches `sendHour[ch]` (or `bestHr[i]` when `'adaptive'`; the control cohort always uses 10:00); and the day's channel quota (`budget.byChannel[ch]/daysTotal / unitCost`) is not exhausted.
   - Otherwise `due` moves to the next eligible hour.
   - Caps: 150 sends per campaign per tick, 600 global per tick.
   - Iterating in propensity order makes budget-capped volume produce genuinely **diminishing returns**.
5. **Paid channels** (social, web): `spend_t = dailyBudget × hourShape[h]`. Outcomes are aggregate draws from the latent curves (§5.3). Conversions are assigned to `k` audience members with ads consent, sampled by `prop`, which writes touches for attribution.
6. Aggregate into `metrics.days[d]` (tot / trt / ctl / ch / v / attr), then `bump('metrics','profiles','enroll')`.
7. **Runtime:**
   - Expire pending proposals with `expiresTick <= t`.
   - Realize impacts for applied proposals where `applyTick + horizon == t`.
   - Run due agents in `def.order`, then auto-apply per autonomy.
   - Exactly one store notify follows.

### 5.2 Per-send outcome (profile i, variant v, channel c, hour h)

```
hourFit   = exp(-dcirc(h, ph_i)^2 / 8)                  // dcirc = circular hour distance
fat       = 0.35 * F_i
deliver   ~ Bern(pd_c)                                    pd = {email .985, sms .97, push .93}
open      ~ Bern(σ(a_c + 1.4·eng_i + qo_v + 0.9·(hourFit−0.5) − fat))     a = {email −1.25, push −2.1}; sms: p=.92
click|open~ Bern(σ(b_c + qc_v + 0.6·ln(5·aff_i[cat_v]) + 0.4·ln cf_i[c]))  b = {email −2.0, sms −2.6, push −2.3}
conv|click~ Bern(σ(−2.6 + 0.9·p0_i + qv_v + offerLift_v − 0.5·priceSens_i·[offer=none]) · season(d))
revenue   = price(product) · lognormal(0, .35) · (1 − discount)
unsub     ~ Bern(0.0012 · (1 + 1.6·F_i) · (1 + spam_v))
cost      = unitCost_c   {email .03, sms .045, push .01}
after send: F_i += 1; sent7++; eng counters; openHr[h]++ on open; touch ring push (cid, c, t)
season(d) = 1 + 0.08·weekend + 0.55·exp(−(d−20)²/6)      // Black Friday bump
```

**Variant latent quality:** `q = 0.8 × (copy.score contributions on the same feature scale) + ε`, where `ε ~ N(0, 0.25)` is drawn from `fork(seed,'variant',vid)`. The predicted score is mostly right, which leaves room for the bandit to add value. When a variant's text is edited, q is recomputed from the new features with the same ε.

### 5.3 Paid channel curves

```
daily conversions = A_true·(1 − e^{−s/B_true})·creativeQ / AOV
```

Spread through `hourShape`. Values come from Poisson draws, using a normal approximation when λ > 30.

**Calibration targets** (core tunes these):

- Email open 18–26%, CTR 2–3.5%, conversion per click 4–8%.
- SMS CTR 6–9%, push open 8–12%, unsubscribes 0.1–0.3% per send.
- Social ROAS 2–4×.
- Seeded goals reach about 85–100% with agents Off and about 100–120% with default autonomy.

### 5.4 Predictive models (visible attributes only)

| Model | Formula |
|---|---|
| Propensity (30d) | `σ(w·x)`, where x = [1, recencyDays/90, ln(1+orders), ln(1+spend)/6, engRate30, visits30/10, max aff, tenure/365]. Fit at boot with 60 gradient-descent iterations (lr 0.5, L2 1e-3) on a synthetic 30-day purchase label; weekly warm-start refit. |
| Churn risk | `σ(−2.2 + 1.6·recency/90 − 0.5·ln(1+orders) − 1.8·engRate30)` |
| Predicted LTV (12 mo) | `orders/(tenure/365) · 12/12 · (1 − churn) · aov`, clipped to the p99 |
| Best channel | argmax over consented channels of `(click_c + 20·m_c)/(sent_c + 20)` (m_c = channel mean) |
| Best hour | argmax of the `openHr` histogram smoothed with circular kernel [.25 .5 .25]. With fewer than 3 opens, fall back to the segment mode. |
| Content score | `logitO = −1.35 + .18 num + .22 personal + .12 urgency − .012·max(0,len−45) + .15 toneFit − .25 caps`; `logitC = −2.9 + .30 cta + .25 offer + .15 image + .20 toneFit − .05·max(0,grade−8)`; `score = clamp(50 + 25·zO + 25·zC, 0, 100)`. zO and zC are standardized against the template-bank distribution computed at boot. |
| Forecast | Deseasonalize with day-of-week indices, then Holt (α, β grid {.1….9} minimizing one-step SSE). `ŷ_{t+h} = (ℓ + h·b)·I_dow`. `Var_h = σ²·(1 + Σ_{j<h}(α(1+jβ))²)`. 80/95% bands. |
| Goal probability | `Φ((actual + Σmean − goal) / sqrt(ΣVar))` |
| Anomalies | `μ ← λy + (1−λ)μ`, `s² ← λ(y−μ)² + (1−λ)s²`, flag `|z| ≥ 3` after 7 points, on complete days only |
| Response curve | Grid over B (20 log-spaced values from 0.2× to 5× mean spend); A by closed-form least squares; keep the best r². If r² < 0.3, fall back to the prior `B = 2·meanSpend`, `A = meanRevenue/(1−e^{−0.5})`. Marginal ROAS = `(A/B)e^{−s/B}`. |
| Bandit P(best) | Thompson: `draws` rounds, sample each arm's Beta, count argmax winners |
| Attribution | Last-touch: the last touch within 7 days gets 100%. Linear: equal share across touches within 7 days (max 8). History days are credited to the sending channel. |
| Control lift | `lift = (r_trt − r_ctl)/r_ctl`, CI by the delta method on two Wilson intervals |
| Realized impact | Difference-in-differences on the target (campaign × channel): `[(r_post − r_pre)_trt − (r_post − r_pre)_ctl] × volume_post × value`, with windows equal to the horizon |

### 5.5 Performance budget

| Operation | Budget |
|---|---|
| `data.generate` | < 300 ms (history as aggregate daily draws plus per-profile engagement counts) |
| `segments.evaluate` | < 10 ms (closure-compiled predicates) |
| `tickOnce` | < 8 ms typical, < 30 ms when Scout runs |
| Clock behavior | If a tick overruns its interval, skip rather than queue. A hidden tab runs at most 1 tick per fire. |

---

## 6. Agents

### 6.1 Agent definition contract

```js
MC.runtime.register({
  id, name, short, icon, order,
  cadence:{ default, min, max, phase },     // runs when (t − phase) % cadence == 0, or runRequested
  autonomy:{ default, allowed:['off','suggest','autopilot'] },
  params:{ key:{ label, type:'int'|'float'|'pct'|'bool', default, min, max, step, help } },
  emits:[actionTypes], guardrails:[ids], notifyDefault:'changes',
  materiality:{ metric, min },               // proposals below this are dropped (logged in trace)
  observe(world, ctx) -> obs,                // world = observeView (no latent); obs is canonical JSON
  decide(obs, ctx{ rng, tick, params, world, models, copy, segments }) -> { proposals:[Draft], trace:[Step] },
  risk(draft, world) -> 'low'|'medium'|'high',
  horizon: ticks                             // used to realize impact
})
```

**Runtime per run:**

1. `rng = fork(seed, 'agent:'+id, tick)`.
2. `inDigest = digest(obs)`.
3. Call `decide`.
4. For each draft: assign id `${id}-${tick}-${k}`, evaluate guardrails, set `baseVer`, apply cooldown and dedupe (an open proposal on the same `kind+target` becomes `superseded`), and set `expiresTick = t + 48`.
5. Route by autonomy. **Autopilot** applies only if every blocking guardrail passes **and** risk ≤ `autopilotMaxRisk` (default `'low'`; Optimizer `'medium'`). Anything else queues with the reason "Needs you: {first failed guardrail or 'High risk'}".
6. Record `outDigest = digest(proposals)`, `chain = fnv(prev + inDigest + outDigest)`, and a feed item.

**Guardrail registry**

| id | Label | Blocking | Rule |
|---|---|---|---|
| `consent` | Consent respected | yes (immutable) | No action targets an unconsented channel. Proposed audiences must have ≥ 50% reach on the campaign's primary channel. |
| `freqCap` | Frequency cap | yes | Projected sends stay within the 7-day cap (also enforced in sim) |
| `quietHours` | Quiet hours | yes | SMS/push send hour not in 21:00–08:00 |
| `maxShift` | Max change per run | yes | Allocation or budget moved ≤ `maxShiftPct` |
| `minSample` | Minimum sample | yes | ≥ `minSample` sends before pausing; ≥ support for segments |
| `keepOneLive` | Keeps a variant live | yes | Never pauses the last live variant |
| `budgetCap` | Within budget | yes | Campaign total unchanged; daily ≤ `maxDailySpend` |
| `protectDrafts` | Doesn't touch drafts | yes (immutable) | Target campaign not in `draft` |
| `brand` | Brand & compliance | yes | `MC.copy.check` has no `fail` |
| `targetFresh` | Unchanged since proposed | yes | `baseVer` matches at apply time |
| `maxSuppress` | Suppression ≤ 15% of audience | yes | |
| `holdout` | Control group untouched | yes | Actions never change control cohort treatment |

### 6.2 Agent roster

| id | Name | Cadence (phase → clock) | Default | Kinds |
|---|---|---|---|---|
| `optimizer` | Variant Optimizer | 6 (1 → 01,07,13,19) | Autopilot | `traffic-shift` (low), `pause-variant` (medium) |
| `sendtime` | Send-Time Tuner | 24 (2 → 02:00) | Autopilot | `send-time` (low), `adaptive-send` (low) |
| `pacer` | Budget Pacer | 24 (3 → 03:00) | Suggest | `budget-shift` (low ≤ 10%, else medium), `pacing` (insight) |
| `guard` | Fatigue Guard | 12 (5 → 05,17) | Autopilot | `fatigue-suppress` (low), `pause-channel` (high) |
| `analyst` | Insight Analyst | 6 (4) | Suggest | insights (`anomaly`, `goal-risk`, `roi`); `extend-campaign` (medium) |
| `copy` | Copy Drafter | 48 (6) | Suggest | `new-variant` (medium) |
| `scout` | Segment Scout | 48 (8) | Suggest | `new-segment` (low), `retarget` (high) |
| `planner` | Campaign Planner | 168 (58 → Mon 10:00) + on demand | Suggest (Autopilot disallowed) | `campaign-draft` (low; creates drafts only) |

### 6.3 Agent details

**Variant Optimizer.** *"Shifts traffic toward the variants that are winning."*

- **Observe:** each live campaign × owned channel with ≥ 2 live variants. Uses treatment-cohort `{sends, conv, clicks, revenue}` per variant, the current `alloc`, `predicted`, and the goal type.
- **Decide:**
  1. Reward: conversions per send (revenue, conversion and reactivation goals) or clicks per send (engagement and launch goals).
  2. Prior `Beta(1 + k·p̂, 1 + k·(1−p̂))`, where p̂ is the predicted rate.
  3. Compute `pBest` from `probBest(draws)`, then `target = max(minShare, pBest)` normalized.
  4. Step: `new = old + clamp(target − old, ±maxShift)`, renormalized.
  5. Emit only if `Σ|Δ|/2 ≥ 0.05`.
  6. Pause a variant if `pBest < pauseBelow`, its sends ≥ `minSample`, and ≥ 2 others are live.
- **Impact:** `Σ Δshare·rate × projected 7d sends × AOV`, with the band from posterior SD.
- **Example title:** "Shift 15% of email traffic to “Layer up before the first frost”". **Why:** "Leads at 0.41% conversions per send vs 0.29% after 1,240 sends; 94% chance it's best."
- **Params:** `draws` 400 [100–2000], `priorStrength` 20 [0–200], `minShare` 0.05 [0–0.2], `maxShift` 0.20 [0.05–0.5], `pauseBelow` 0.02 [0–0.1], `minSample` 500 [100–5000].
- **Guardrails:** minSample, maxShift, keepOneLive, protectDrafts, targetFresh, holdout.
- **Horizon:** 72.

**Send-Time Tuner.** *"Moves sends to the hours people actually open."*

- **Observe:** `metrics.hours[cid][ch]`, the audience `bestHr` histogram, the current `sendHour`, and quiet hours.
- **Decide:**
  - `rate_h = (opens_h + m·prior_h)/(sends_h + m)`, circularly smoothed. Candidate hours exclude quiet hours for SMS/push.
  - If `best/current − 1 ≥ minLift` and opens ≥ `minOpens`, emit `send-time`.
  - If `allowAdaptive`, the top hour's share is < 20%, and ≥ 60% of the audience has ≥ 3 opens, emit `adaptive-send` ("Send at each person's best hour").
- **Params:** `minLift` 0.05 [0.01–0.3], `minOpens` 150 [50–2000], `smoothing` 50 [0–500], `allowAdaptive` true.
- **Guardrails:** quietHours, protectDrafts, targetFresh.
- **Horizon:** 96.

**Budget Pacer.** *"Keeps spend on plan and moves budget to the channel returning the most."*

- **Observe:** per live campaign: budgets, spend to date, days left, daily (spend, revenue) per channel over `lookbackDays`, and fitted curves.
- **Decide:**
  - **Pace** = 3-day average spend / planned daily. If off by more than `paceTolerance`, emit a `pacing` insight.
  - **Reallocate:** repeatedly move `stepPct` of the daily total from the channel with the lowest marginal ROAS to the highest, while `m_max/m_min > 1.10` and the cumulative move ≤ `maxShiftPct`. Both curves need r² ≥ `minFit`. The total is preserved.
- **Example title:** "Move $840 from Social ads to SMS on Lapsed Hiker Win-back". **Why:** "SMS returns $5.80 per extra $1 vs $1.90 on social at current spend."
- **Params:** `stepPct` 5 [1–10], `maxShiftPct` 20 [5–50], `lookbackDays` 21 [7–60], `minFit` 0.3 [0–0.9], `paceTolerance` 0.15 [0.05–0.5].
- **Guardrails:** maxShift, budgetCap, protectDrafts, targetFresh.
- **Horizon:** 120.

**Fatigue Guard.** *"Rests people who are being messaged too much, before they unsubscribe."*

- **Observe:** treatment members of live campaigns: `F`, `sent7` vs cap, `unsubRisk = σ(−7 + .55F + .8·[sent7 ≥ cap−1] − 1.2·engRate)`, and each campaign's unsubscribe EWMA z.
- **Decide:**
  - Profiles with risk ≥ `unsubRiskThreshold` that are not already suppressed are kept in descending risk order, capped at `maxSuppressPct` of the audience. They are suppressed per channel until `t + cooldownDays·24`.
  - If z ≥ `unsubZ`, emit `pause-channel` (always queued).
- **Impact shows the trade-off:** "Avoids ~14 unsubscribes · forgoes ~$90 revenue".
- **Params:** `unsubRiskThreshold` 0.008 [0.002–0.05], `cooldownDays` 3 [1–14], `maxSuppressPct` 15 [1–30], `unsubZ` 3 [2–5].
- **Guardrails:** consent, maxSuppress, holdout, targetFresh.
- **Horizon:** 72.

**Insight Analyst.** *"Watches the numbers, flags surprises, and warns when a goal is at risk."*

- **Observe:** complete-day series per campaign for revenue, conversions, CTR, unsubscribe rate and spend; forecasts; goals.
- **Decide:**
  - EWMA anomalies.
  - Goal risk from `goalProbability`.
  - Weekly ROI ranking by segment × campaign, using attribution and cost.
  - Insights are deduped by `key` per day.
  - If P(goal) < `goalRiskThreshold`, the campaign is live, and ≥ 48h remain: emit `extend-campaign` with `+min(maxExtendDays, ceil(gap/meanDaily))` days, always queued.
- **Narrative templates:**
  - "{metric} on {campaign} {rose|fell} to {value} on {day}, {z}σ from the expected {expected}."
  - "{campaign} is on pace for {pct} of its {goal} goal ({p}% chance of hitting it)."
  - "{segment} drove {share} of {campaign} revenue from {sizeShare} of its audience, {ratio} the average return."
- **Params:** `z` 3 [2–5], `lambda` 0.2 [0.05–0.5], `goalRiskThreshold` 0.5 [0.2–0.8], `maxExtendDays` 7 [1–14].

**Copy Drafter.** *"Writes a fresh challenger when a winner tires or a test has settled."*

- **Trigger:** the leader's 3-day CTR ≤ (1 − `decayThreshold`) × its peak, **or** the leader's pBest ≥ 0.9 (from the Optimizer's latest audit), **and** live variants < `maxVariants`.
- **Decide:**
  1. `MC.copy.generate({…campaign tone/product/offer, count: candidates, seedKey:'copy:'+cid+':'+ch+':'+t})`.
  2. Drop any brand `fail`, and drop near-duplicates (feature distance < 0.2).
  3. Take the best score.
  4. Actions: `variant/create` (author `agent:copy`, status live) plus `campaign/setAlloc`, giving `challengerShare` taken pro rata.
- **Params:** `decayThreshold` 0.15 [0.05–0.5], `candidates` 6 [2–12], `maxVariants` 4 [2–6], `challengerShare` 0.10 [0.05–0.25].
- **Guardrails:** brand, maxShift, protectDrafts, targetFresh.
- **Horizon:** 96.

**Segment Scout.** *"Finds pockets of customers who respond far better than average."*

- **Observe:** visible features (region, tier, category, age band, tenure band, recency band, prop/churn/LTV deciles, bestCh, bestHr band, consent) and the label "converted within `lookbackDays` given touched".
- **Decide:**
  - Candidate conditions: each category value, plus `≥` / `<` at each decile.
  - Score = `lift·sqrt(n)`. Greedy search to `maxDepth`.
  - Keep rules with lift ≥ `minLift` and support ≥ `minSupport`. Drop rules with Jaccard > 0.8 vs existing segments or open proposals. Take the top K.
  - Names are deterministic from `describe()`, e.g. "Summit-tier hikers, Pacific Northwest".
  - Optional `retarget` ("Add to Winter Layering Launch audience") is always queued.
- **Params:** `lookbackDays` 14 [7–45], `minSupport` 150 [50–1000], `minLift` 1.3 [1.1–3], `maxDepth` 2 [1–3], `topK` 2 [1–5].
- **Guardrails:** minSample, consent, protectDrafts.

**Campaign Planner.** *"Turns a brief into a full plan you can edit section by section."*

`preview('planner', {brief, regen:{section:n}})` produces a plan:

| Section | Method |
|---|---|
| Audience | Rank existing segments plus 3 goal templates by `EV = reach × mean(prop) × AOV × goalWeight`; show the top 3 |
| Channels & budget | Prior ROAS table (goal × channel from history); equal-marginal split on curves; ≥ 10% per selected channel |
| Journey | `GOAL_TEMPLATES[goal]`. Example for revenue: Entry → Email A/B → Wait 48h → Opened? (yes: Push if consented / no: SMS if consented) → Wait 72h → Purchased? (yes: Exit / no: Last-call email) |
| Content | `copy.generate` with 3 variants per owned channel and 2 for social |
| Forecast | Sum over channels of `R(daily)·days ± 1.28σ` |
| Preflight | Consent coverage; overlap with live campaigns and projected frequency-cap collisions; budget vs cap; quiet hours; brand checks |

- `regen` uses `fork(seed,'planner',briefDigest,section,n)`.
- **Weekly run:** if a `MC.time.EVENTS` day within 21 days has no campaign, emit `campaign-draft` ("Draft: Cyber Monday follow-up for Black Friday browsers").
- **Params:** `lookaheadDays` 21, `minSegmentSize` 300, `variantsPerChannel` 3.

---

## 7. Views (the marketer's day)

### 7.0 Global chrome (`js/app.js`, ui)

**Breakpoints:** ≥ 1200 wide · 960–1199 standard · 640–959 icon rail (64px) · < 640 phone. The gutter is `clamp(16px, 2.5vw, 32px)` with max content width 1440. The layout is left-aligned (no centered layouts).

**Sidebar (232px)**

- Kestrel mark (inline SVG bird glyph) with "Kestrel".
- Nav: Command Center, Campaigns, Content Studio, Audiences, Analytics, Agents. Agents carries a russet count badge for pending approvals.
- Footer: "Fernway Outfitters" with a `Sample data` pill, and a theme segmented control labeled `System · Light · Dark`.

**Top bar (sticky, `top: env(safe-area-inset-top, 0px)`)**

- Page title in Bricolage, plus a breadcrumb inside Campaigns.
- Sim clock in mono: `Sat, Nov 7 · 14:00`, with a sub-label `Sim day 1`.
- Speed segmented control `Pause · 1× · 4× · 16×` (aria-pressed). `Step 1h` appears only while paused.
- **AgentPulse:** 8 dots. A dot glows russet for one tick when its agent ran (static ring under reduced motion). Hollow means paused; grey means off. Text: `7 agents working · 4 need you`.
- `Approvals` button with a count badge.
- Overflow menu: `Restart simulation…` with an inline confirm.

**Phone (< 640):** the top bar shows the mark, page title, compact clock `Nov 7 14:00`, a play/pause button, Approvals, and a menu button. The menu opens a sheet with the nav, speed, and theme controls.

**Sample-data strip** (dismissible, kept in uiStore and localStorage): "You're exploring sample data. Fernway Outfitters is fictional; customers, results and agents run on a deterministic simulator." Button: `Got it`.

**Approvals drawer**

- Right side, 440px wide; a full-height sheet on phones. Focus trap; Esc closes; focus returns to the trigger.
- Tabs: `Needs you (n)` · `Applied by agents` · `History`.
- Filter chips: agent, risk.
- Bulk action: `Approve all low-risk (3)` with an inline confirm: "Approve 3 low-risk changes? Each can be undone."

**ProposalCard anatomy** (shared by the drawer, Home, campaign detail, and Agents)

```
[● Variant Optimizer]  Traffic shift · Low risk                     2h ago
Shift 15% of email traffic to “Layer up before the first frost”
Why        Leads at 0.41% conv/send vs 0.29% after 1,240 sends; 94% chance it's best.
Expected   +$1,860 revenue over 7 days ($1,220–$2,500) · confidence 82%
Guardrails ✓ Minimum sample (1,240 ≥ 500)  ✓ Max change per run (15% ≤ 20%)  ✓ Keeps a variant live
Changes    A 50% → 35%   B 30% → 45%   C 20% → 20%        [AllocationBar before/after]
[Approve]  [Dismiss ▾]  [Open campaign]                  Expires in 41h
```

- Checks and crosses are SVG icons.
- Dismiss reasons: `Not now` · `Not a good idea` · `Other`.
- Applied cards show `Undo`. Undo is disabled with an explanation when the target changed since: "Can't undo: Variant Optimizer changed this allocation again at 19:00. Open the campaign to adjust."
- Stale on approve: "No longer applies: the campaign changed since this was proposed." The card then moves to History.

**Toasts**

- Bottom-right, at most 3, `aria-live=polite`. Hide after 6s; pause on hover or focus.
- Coalesced per tick: one autopilot change gives "Variant Optimizer shifted 15% of email traffic on Winter Layering Launch · Undo · View". Several give "Agents made 3 changes · Review". New queue items give "2 new items need you · Review".
- Notify level per agent (uiStore): `All activity / Changes only / Silent`. Default is `Changes only`.

**Route handling:** each view is wrapped in an ErrorBoundary that shows "This view hit an error. [Reload view]" plus details. A missing `MC.views.x` shows "This area is still being built." On route change, focus moves to the page `<h1>`.

### 7.1 Command Center (`#home`)

**First glance:** goal status and what needs you, both above the fold.

```
Command Center                                              [Plan a campaign]
Sat, Nov 7 · 14:00 · Sim day 1
┌ Revenue · Nov ┬ Conversions · Nov ┬ Return on spend ┬ Unsubscribe rate ┐
├ Forecast (8 col) ───────────────────────────┬ Needs you (4 col) ───────┤
├ What changed (8) ───────────────────────────┼ Agents (4) ──────────────┤
├ Live campaigns (12) ────────────────────────────────────────────────────┤
```

On phones the order is: KPI 2×2, Needs you, Forecast, What changed, Agents, Live campaigns.

| Component | Spec |
|---|---|
| KPI tile | Label; value (Bricolage 28px, tabular); `of $140k goal`; Meter with goal tick and a ghost segment for the forecast month-end; DeltaBadge "+6.2% vs prior 7 days"; Sparkline 14d; pill `On track` (P ≥ 0.7, good) / `At risk` (0.4–0.7, warn) / `Off track` (crit). The unsubscribe tile uses guardrail framing: "Target ≤ 0.25%". Clicking a tile opens Analytics with the metric preselected. |
| Forecast | Headline: "November revenue is on pace for **$412k** ($371k–$455k), 6% above the $140k goal." ForecastChart in cumulative mode (actual solid, forecast dashed, 80% band, goal line, today marker). Below: "Biggest movers this week", 3 rows such as "+$2.1k Winter Layering Launch · after Variant Optimizer shift (Nov 9)". |
| Needs you | Up to 3 compact ProposalCards (title, agent chip, impact, risk, `Approve`, `Dismiss`); footer `See all 4 in Approvals`. |
| What changed | Feed grouped under `Today` / `Yesterday` / date headings. Row: mono time · AgentChip or icon · sentence · inline `Undo` / `View`. Filter chips: `All · Agents · Anomalies · Campaigns · Yours`. **Freeze:** while scrolled past the top or focused inside, new items collect into a `3 new updates` pill. |
| Agents | Rows: status dot · name · autonomy pill · `ran 2h ago · next in 4h` · `24h: 3 changes`. Footer: `Manage agents`. |
| Live campaigns | DataTable: Campaign · Channels (icons) · Spend/Budget bar · Revenue vs goal · Outlook pill (`Likely 104%`) · Agent changes 24h (russet count). Clicking a row opens the campaign detail. |

| State | Behavior |
|---|---|
| Boot | Static boot text, then skeleton tiles |
| Tick 0 | Feed: "Agents start their first runs within the hour. Changes will appear here." |
| Empty Needs you | "Nothing needs you right now. Agents on Suggest will queue changes here." |
| No live campaigns | "Nothing is live right now. Plan a campaign or schedule a draft." |
| Paused | The clock shows a `Paused` chip and the pulse dots go hollow |
| Live | KPIs re-render once per tick. A changed value gets a 1.2s accent underline (none under reduced motion); if the change was agent-caused, the underline is russet. |

**Selectors:** `select.kpis`, `select.forecast({metric:'revenue', month})`, `select.openProposals`, `select.feed`, `select.agentRoster`, `select.campaignRows`.

### 7.2 Campaigns (`#campaigns`)

Sub-mode is held in `uiStore.focus.campaigns = {mode:'board'|'list'|'calendar'|'planner'|'detail', id, tab}`. Tabs: `Board · List · Calendar`. Primary button: `Plan a campaign`.

**Board columns:** `Draft · Scheduled · Live · Completed` (paused campaigns sit in Live with a Paused pill).

- Card: name, `Nov 20 – Dec 1`, channel icons, goal meter "$12.4k of $38k", outlook pill, live sparkline, and the russet line "2 agent changes today".
- Card menu: `Schedule… · Pause · Resume · End campaign · Duplicate brief`. No drag. Keyboard operable.

**List:** sortable DataTable. Order is frozen while the table has focus.

**Calendar:** Gantt from Nov 1 to Dec 31. Shows a now-line labeled with sim time, markers for Thanksgiving / Black Friday / Cyber Monday, and status-colored bars. Placed in an `overflow-x:auto` container with min-width 720.

**Planner**

```
← Campaigns   New campaign plan                         [Discard brief] [Create draft campaign]
┌ Brief (5 col) ───────────────┬ Plan draft (7 col) ───────────────────────────────────────┐
│ Campaign name  #brief-name    │ "Drafted from your brief at 14:00 · 6 sections · 2 to review" │
│ Goal [Revenue▾] #brief-goal   │ 1 Audience            [Accept] [Regenerate] [Edit]         │
│ Target  #brief-target         │ 2 Channels & budget   AllocationBar + per-channel $ + why  │
│ Product focus #brief-product  │ 3 Journey             FlowDiagram (compact)                │
│ Audience [Let the planner     │ 4 Content             variant cards w/ ScoreRing           │
│   suggest ▾] #brief-segment   │ 5 Forecast            ForecastChart + "Expected $41k–$52k" │
│ Budget #brief-budget          │ 6 Preflight checks    GuardrailList (pass/warn/fail)       │
│ Start #brief-start End #brief-end │ ▸ How this plan was made (trace)                      │
│ Channels (ChipToggles)        │                                                            │
│ Tone [Practical|Adventurous|Warm|Urgent]  Offer [▾]                                        │
│ [Draft plan]                  │                                                            │
```

- The brief is local state, mirrored to `uiStore.plannerBrief` so it survives navigation: "Your brief is kept while you move around the app."
- `Draft plan` runs `runtime.preview`, which is pure. After that, editing the brief does **not** auto-regenerate. A pill appears instead: `Plan is out of date — your brief changed · Refresh plan`.
- Each section has `Accept` (checkmark state), `Regenerate` (deterministic next alternative), and `Edit` (inline form, local).
- `Create draft campaign` dispatches `campaign/create` with the full accepted plan and variants, then opens the detail view.
- `Schedule` requires preflight to have no `fail`.
- The Holiday Gift Guide draft opens here via `Continue planning`.
- Empty right pane: "Fill in a goal and budget, then Draft plan. The planner proposes an audience, channel mix, journey, content and a forecast — you accept each part."

**Campaign detail**

Header: name, StatusPill, dates, `Edit brief`, `Pause campaign` / `Resume`, `End campaign…` (inline confirm). Tabs: `Overview · Journey · Content · Audience · Budget · Activity`.

| Tab | Layout & components | Live behavior |
|---|---|---|
| Overview | Left (8): KPI row (Revenue vs goal, Conversions, ROAS, Spend pace); LineChart with agent markers (russet ticks; hover shows "Budget Pacer moved $840 to SMS"). **Variant leaderboard** per channel tab: Variant · Author (AgentChip if agent) · AllocationBar (previous as ghost) · Sends · Open · Click · Conv/send ± CI · P(best). Right (4): "Agent changes on this campaign" timeline, pending ProposalCards for this campaign, and a **Control group lift** card: "+14% conversions per send vs control (±6%)". | Rows update in place by id. Allocation animates from old to new (instant under reduced motion). A "Changed by Variant Optimizer 19:00" chip shows for one sim day. |
| Journey | FlowDiagram (left-to-right; top-to-bottom on phones). Nodes show `In step 412 · Sent today 180`, and decision branches show percentages. Agent-tuned nodes get a russet corner tag, e.g. "Send-Time Tuner: 19:00" or "Adaptive". Clicking a node opens an inspector panel (wait hours, channel, variants, rule); the whole journey is a local draft. Buttons: `Save journey`, `Discard`. Note on live campaigns: "Changes apply to people entering a step after you save." | Counts tick live. An inspector draft with a conflict shows "Updated by Send-Time Tuner while you were editing · Use theirs / Keep mine". |
| Content | Variants grouped by channel with mini previews and a ScoreRing; `Open in Content Studio` (`nav.go('content', {variantId})`) and `+ New variant`. | Stats strip per variant |
| Audience | Segment summary (count, reach, traits) with `Change segment`. Suppressions list; agent-added entries carry an AgentChip and `Release`. | Counts refresh daily |
| Budget | Table: Channel · Budget · Spent · Pace · Marginal ROAS. Small-multiple ResponseCurve per channel with current and proposed dots. Allocation editor uses `useDraft` with `Save budget`. | A conflict chip appears if the Pacer applies while the editor is dirty |
| Activity | Feed and audit filtered to `entity.id`, with links to run traces | Frozen list behavior |

### 7.3 Content Studio (`#content`)

```
┌ Library (3) ────┬ Composer (5) ─────────────────────────┬ Preview & checks (4) ──┐
│ Search          │ [Email][SMS][Push][Social]  Variant B ▾│ Preview as [Maya R. ▾] │
│ All·Drafts·Live·│ Subject      #cs-subject     48/60     │ Inbox row + body render│
│ Agent-drafted   │ Preheader    #cs-preheader             │ ────────────────────── │
│ ▸ Winter Layer… │ Headline     #cs-headline              │ Predicted engagement 71│
│   A ● live 35%  │ Body         #cs-body (textarea)       │ Why this score (bars)  │
│   B ● live 45%  │ Button label #cs-cta  Link {product}   │ ────────────────────── │
│   C ◌ Copy Draf.│ Image [picker] Alt text #cs-alt        │ Brand & compliance     │
│                 │ Insert ▾ {first_name} {product} {offer}│ ✓ ✓ ! ✓  [Fix]         │
│                 │ Unsaved changes · [Save] [Save as new] │ Live performance strip │
│                 ├ Generate variants ─────────────────────┤                        │
│                 │ Tone · Offer · Product · Count(3–6)    │                        │
│                 │ Lock: ☐Subject ☐Headline ☑Button label │                        │
│                 │ [Generate 4] → cards: ScoreRing, chips │                        │
│                 │ "Number in subject" "Personalized"…    │                        │
│                 │ [Add to campaign ▾] [Compare]          │                        │
```

On phones the panes become tabs: `Compose · Preview · Checks`.

- **Channel fields:**
  - SMS: one text field with a counter `128/160` and an auto-check for "Reply STOP to opt out".
  - Push: title (40) and body (120).
  - Social: primary text (125) and headline (40).
  - The image slot uses a synthetic SVG illustration library (6 product scenes) and requires alt text.
- **Previews:**
  - Email: inbox row (sender "Fernway Outfitters", subject, preheader) plus the rendered body.
  - SMS: message bubble.
  - Push: lock-screen card.
  - Social: ad card.
  - Tokens are filled from the "Preview as" profile.
- **Why this score:** horizontal contribution bars, e.g. "+8 Personalized · +5 Number in subject · −4 Subject 68 chars (over 60)".
- **Checks:** banned words, length limits, CTA present, alt text, reading grade ≤ 8 (shows "6.2"), no ALL CAPS, the discount claim matches the offer, and SMS opt-out. A `Fix` button applies the deterministic `fix`; this edits the local draft only.
- **Live variant editing:** an inline warning reads "This variant is live in Winter Layering Launch. Saving changes resets what we've learned from 1,240 sends." Buttons: `Save as new variant` (primary) and `Save anyway`.
- **Generation** is pure (`MC.copy.generate`). Only `Add to campaign` dispatches `variant/create` with full fields at the selected share.
- **Agent-drafted variants** carry a russet badge "Drafted by Copy Drafter" and link to their pending proposal.
- **Library states:**
  - Empty: "No content yet. Start from a campaign or generate variants from a tone and product."
  - Nothing selected: "Pick a variant on the left, or generate new ones."
- **Live updates:** only the performance strip and library status dots update. Composer fields never re-render from the store while dirty. If the selected variant's `ver` changes underneath, a conflict chip appears.

### 7.4 Audiences (`#audiences`)

Tabs: `Segments · Builder · Profiles · Overlap`.

**Segments:** DataTable with Name · Size (live) · 7d change · Avg propensity · Predicted LTV · Return (from attributed revenue / cost) · Used in · Author. Above the table: a panel **Suggested by Segment Scout**, with a card per proposal ("Summit-tier hikers, Pacific Northwest · 412 people · converts 2.1× average") and buttons `Create segment` / `Dismiss`.

**Builder**

```
Describe your audience  #aud-describe  [e.g. lapsed hikers in the Pacific Northwest with high predicted LTV] [Build rules]
Understood: [lapsed → Last order > 120 days ago] [hikers → Hiking affinity ≥ 0.3]
            [Pacific Northwest → State is WA, OR or ID] [high predicted LTV → Predicted LTV ≥ $480 (top 25%)]
Ignored: "with"                                                    Replaces current rules · Undo
┌ Rules (7 col) ──────────────────────────────────┬ Live audience (5, sticky) ─────┐
│ Match [all | any] of:                            │ 2,184 people · 36% of 6,000    │
│  [Last order (days ago)▾][more than▾][120] [×]   │ Reachable by                   │
│  ┌ Match any of ─────────────────────────────┐   │  Email 2,010 ▇▇▇▇  SMS 840 ▇▇  │
│  │ [State▾][is any of▾][WA, OR, ID] [×]      │   │  Push 990 ▇▇                   │
│  └ [+ Condition] [+ Group] ───────────────────┘   │ Propensity · Churn · LTV hists │
│  [+ Condition] [+ Group]                          │ Tier bars · Best channel bars  │
│ In plain words: "People whose last order was …"   │ Best send hour strip           │
│ Name #seg-name  [Save segment] [Use in campaign ▾]│ Sample members (5)             │
```

- The attribute picker is grouped `Profile · Behavior · Predictions`. Predictions carry a `Predicted` badge: Propensity to buy (30 days), Churn risk, Predicted LTV (12 months), Best channel, Best send hour.
- Groups nest up to 3 levels. Control ids are stable: `aud-c-{path}-attr|op|val`.
- The count uses the **draft** rule (`useDebounced` 150ms then `segments.evaluate`). The panel shows "Counted in 2 ms". No store write happens until `Save segment`.
- Empty: "Start by describing who you want to reach, or add a condition."
- Zero matches: "No one matches. Loosen a condition — the strictest is *Predicted LTV ≥ $900* (removes 97%)." This uses per-condition elimination counts.

**Profiles**

- Search by name or id; segment filter; 50 rows per page with `Previous` / `Next` and "1–50 of 2,184".
- Columns: Name · Location · Tier · Last order · Propensity · Churn · LTV · Best channel · Best hour · Consent icons.
- Selecting a row opens a profile drawer:
  - Header: name, `P-00123` (mono), `Sample profile`.
  - Predictions, each with a "Why" (contributions).
  - Consent badges.
  - Fatigue meter: "High — 5 messages in 7 days".
  - Recent touches timeline from the ring buffer.
  - Segment memberships.
  - Suppressions with `Release`.

**Overlap**

- Check up to 8 segments to get a Heatmap of row-normalized overlap.
- Cell tooltip: "1,120 of 2,184 PNW Hikers are also in Lapsed 120d+ (51%)".
- Empty: "Pick two or more segments to compare."

**Live updates:** counts, distributions and predictions refresh on the daily rescore (`rev.segCounts`). The Builder's draft is never touched.

### 7.5 Analytics (`#analytics`)

**Sticky filter bar:** range `Last 14 days · 30 · 60 · Since sim start` · campaigns (multi-select) · channel · metric `Revenue · Conversions · Clicks · Return on spend` · `Show agent actions` toggle. State lives in `uiStore.focus.analytics`.

| Section | Spec |
|---|---|
| Performance | LineChart of daily actuals plus a 14-day forecast with 80/95% bands. Goal line when a single campaign is selected. Anomaly diamonds (crit/warn). Agent markers on a russet rail under the x-axis; clicking one opens its ProposalCard in a popover. |
| Agent impact | Table: Change · Agent · Applied · Expected · Realized (DiD vs control) · Status (`Measuring… 31h left` / `Realized`). Totals line: "Agents added **+$6,420** realized (expected +$7,900) since Nov 7." Per-campaign control lift with CI. |
| Funnel | Sent, Delivered, Opened, Clicked, Converted, with stage conversion %. Channel toggle. |
| Channels & variants | BarChart with CIs plus a table, sortable by Return. |
| Attribution | `Last touch / Linear` segmented control; StackedBar by channel per campaign; table. |
| Anomalies | List from Insight Analyst: sentence, sparkline with the flagged point, `Dismiss`. |
| What-if budget | Per-channel sliders (local state) next to ResponseCurve small multiples. Summary: "Predicted revenue $48.2k ($43.1k–$53.0k) vs $45.6k now · Return 3.4× → 3.7×". Actions: `Reset`, `Apply to campaign…` (inline confirm, then `campaign/setBudget`), and `Ask Budget Pacer to evaluate`, which dispatches `agent/runNow` and shows "Queued for next tick". |
| Insights | Insight Analyst narrative cards, each with an evidence link to the filtered chart |

**States:** Range has no data: "No sends in this range yet." Forecasts need 7 or more days: "Forecast appears after 7 days of data."

**Live updates:** charts recompute when `rev.metrics` changes and the **day changes** (today's partial bar updates hourly). Hover and tooltip anchor to the day key, not the array index, so they stay put as data appends.

### 7.6 Agents (`#agents`, file `console.js`)

Tabs: `Roster · Activity · Approvals (n) · Guardrails · Audit & replay`.

**Roster:** list on the left, detail panel on the right; stacked on phones.

- Row: icon · name · purpose line · StatusDot (`Running` / `Paused` / `Off` / `Queued run`) · autonomy segmented `Off · Suggest · Autopilot` · cadence select (`Every 6 hours`) · `ran 2h ago · next in 4h` · Track record ("23 applied · 2 undone · realized +$4,210 of expected +$5,030").
- Autonomy helper text:
  - Suggest: "Proposals wait in Approvals."
  - Autopilot: "Applies changes that pass every guardrail; anything else waits for you."
  - Off: "Doesn't run."
- Detail panel:
  - Parameters form: each control labeled, showing default and range, with help text. `Save parameters` and `Reset to defaults`.
  - Notify select.
  - Buttons `Pause agent` / `Resume agent` and `Run now`.
  - Recent runs list; clicking a run opens the trace.

**Run trace (TraceView):**

1. Observe: a summary table plus the `in 3f9a12c4` digest.
2. Decide: numbered reasoning rows with numbers, e.g. "P(best): A 4%, B 94%, C 2%".
3. Guardrails.
4. Actions called: mono list such as `campaign/setAlloc {id:c-wll, channel:email}`.
5. `out 81be07d2` · `chain 5c0d…` · "ran in 3 ms".

**Activity:** live tail of feed and runs. `Live · Pause stream` freezes only the display. Filter by agent and kind.

**Approvals:** full-page version of the drawer with agent, risk and kind filters and bulk actions.

**Guardrails:**

- Frequency caps per channel (number inputs) and quiet hours.
- Max change per run, minimum sample, daily spend cap, control group %.
- Brand rules: banned-words chip editor, max subject length, reading grade.
- Locked rows show a lock icon: "Consent is always enforced" and "Agents never change draft campaigns".
- `Save guardrails` (draft and conflict pattern).

**Audit & replay:**

- Table: Tick · Agent · Run · Inputs digest · Outputs digest · Chain · Actions.
- **Verify determinism** panel: "Seed 20261107 · 37 actions in log · 312 ticks" with the `Verify determinism` button.
  - Progress: "Replaying… 140 / 312 ticks".
  - Match: "Replay matches — state 9f3a12c4 · audit 5c0d77e1 · 312 ticks in 1,840 ms".
  - Mismatch: "Replay diverged at tick 87: Variant Optimizer output differs (live 81be07d2 · replay 2a44c019)", with `Open run`.
- `Show action log` opens a read-only mono list. There is no download.

### 7.7 Copy deck (key labels)

| Context | Exact copy |
|---|---|
| Nav | Command Center · Campaigns · Content Studio · Audiences · Analytics · Agents |
| Clock / speed | `Sat, Nov 7 · 14:00` · `Sim day 1` · Pause · 1× · 4× · 16× · Step 1h · aria "Simulation speed" |
| Pulse | "7 agents working · 4 need you" / "Agents paused" / tooltip "Variant Optimizer · ran 14:00 · 1 change" |
| Approvals | Approvals · Needs you · Applied by agents · History · Approve · Dismiss · Undo · Open campaign · Expires in 41h · Low risk / Medium risk / High risk · "Needs you: {guardrail}" |
| Proposal sections | Why · Expected impact · Guardrails · Changes |
| Restart | "Restart the simulation? This clears every change since Nov 7 · 00:00." [Restart] [Keep going] |
| Home | Revenue · Nov · Conversions · Nov · Return on spend · Unsubscribe rate · On track / At risk / Off track · Forecast · Needs you · What changed · Agents · Live campaigns · "{n} new updates" |
| Planner | Brief · Plan draft · Draft plan · Refresh plan · Accept · Regenerate · Edit · Preflight checks · How this plan was made · Create draft campaign · Discard brief |
| Content | Generate variants · Lock · Predicted engagement · Why this score · Brand & compliance · Fix · Preview as · Save · Save as new variant · Unsaved changes · Add to campaign · Drafted by Copy Drafter |
| Audiences | Describe your audience · Build rules · Understood · Ignored · Match all of / Match any of · + Condition · + Group · In plain words · Reachable by · Save segment · Use in campaign · Suggested by Segment Scout · Create segment |
| Analytics | Show agent actions · Agent impact · Measuring… · Realized · Last touch / Linear · What-if budget · Ask Budget Pacer to evaluate |
| Agents | Run now · Queued for next tick · Pause agent / Resume agent · Reset to defaults · Track record · Verify determinism |
| Conflict chip | "Updated by {agent} while you were editing · Use theirs · Keep mine" |

### 7.8 Live-update safety matrix

| Surface | Source | Rule |
|---|---|---|
| Text inputs, rule builder, journey inspector, budget editors | `useDraft` | Never replaced while dirty; a conflict chip appears instead |
| Feed, Activity, History | `useFrozen` | Frozen while scrolled or focused; "N new" pill |
| DataTables | `freezeOrderWhileFocused` | Values update in place by row key; re-sort is deferred |
| Charts | Day-keyed | Tooltip and hover persist across ticks |
| Selection | `uiStore.focus` by id | If the entity is removed: "This item was removed (by your undo)." |
| Approve / Undo | Re-validation | Stale proposals are never applied; the reason is shown |

---

## 8. UI kit and SVG charts

### 8.1 Tokens (`css/tokens.css`)

- **Colors:** `--ground --surface --surface-2 --ink --ink-2 --ink-3 --line --line-strong --accent --accent-soft --on-accent --agent --agent-soft --on-agent --good --good-soft --warn --warn-soft --crit --crit-soft --focus --chart-1..6 --chart-grid --chart-band --shadow-pop` (shadow only on drawers and popovers).
- **Type and spacing:** `--font-display: "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif; --font-ui: "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif; --font-mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;` with a spacing scale 4/8/12/16/24/32/48 and radii 4/6/10.
- **Charts:** Light `#2F5D86 #1F7F7A #9A6B12 #6B5A9E #5E7F2B #A0465F`. Dark `#8DB4DC #5DC1B4 #D7AE5E #A99BDB #9CC46A #E58FA6`. Every value is ≥ 3:1 against its surface. Russet is reserved for agents and never used as a series color.
- **Soft tints (light/dark):** accent-soft `#E3ECF4` / `#1E2E3F`; agent-soft `#F6E6DD` / `#3A2419`; ink-3 `#65717C` / `#7F8D9A`.
- **Dark mode:** under `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){…}}` and again under `:root[data-theme="dark"]{…}`, both with `color-scheme: dark`. `body{background:var(--ground);color:var(--ink)}`.
- **Numbers:** `.num{font-variant-numeric:tabular-nums}`.
- **Reduced motion:** `@media (prefers-reduced-motion:reduce)` removes transitions, pulse, and tweening.

### 8.2 Kit (`MC.ui.*`, `k-` classes)

| Component | Props |
|---|---|
| `Button` | `{kind:'primary'\|'secondary'\|'ghost'\|'danger', size:'sm'\|'md', icon, onClick, disabled, title, type}` |
| `IconButton` | `{icon, label (required, aria), onClick, pressed}` |
| `Segmented` | `{id, label, options:[{value,label}], value, onChange, size}` (radiogroup, arrow keys) |
| `Field` | `{id, label, hint, error, children}` |
| `TextInput` / `TextArea` / `NumberInput` / `Select` / `Slider` / `Checkbox` | `{id, value, onChange, onBlur, …, maxLength?, counter?}` (uncontrolled-safe) |
| `ChipToggle` | `{id, label, icon, checked, onChange}` |
| `Tabs` | `{id, tabs:[{id,label,count}], value, onChange}` |
| `Badge` / `Pill` / `StatusPill` | `{tone:'neutral'\|'accent'\|'agent'\|'good'\|'warn'\|'crit', children}` |
| `StatusDot` | `{state:'running'\|'paused'\|'off'\|'queued', pulse}` |
| `Panel` | `{title, actions, children, dense}` (bordered, no shadow) |
| `KPI` | `{label, value, format, goal, forecast, delta, spark:number[], status, onClick}` |
| `Meter` / `ProgressBar` | `{value, max, goal?, ghost?, tone, label}` |
| `DataTable` | `{columns:[{key,label,align,format,sort,render}], rows, rowKey, onRowClick, freezeOrderWhileFocused=true, pageSize?, empty}` |
| `EmptyState` | `{icon, title, body, action}` |
| `Skeleton` | `{w, h, lines}` |
| `Drawer` / `Sheet` | `{open, onClose, title, width=440, children}` (focus trap) |
| `InlineConfirm` | `{message, confirmLabel, cancelLabel, onConfirm, onCancel, tone}` (replaces confirm()) |
| `Popover` / `Tooltip` | `{anchorRef, open, onClose, children}` / `{label, children}` |
| `ToastHost` | Reads `uiStore.toasts` |
| `ConflictChip` | `{agentId, onTheirs, onMine}` |
| `NewItemsPill` | `{count, onClick}` |
| `Delta` / `Money` / `Num` | Formatted spans with tabular nums |
| `SampleDataBadge` | none |

**agent-ui.js:**

| Component | Props |
|---|---|
| `AgentChip` | `{agentId, size}` |
| `ProposalCard` | `{id, compact, showTarget}` (reads the store itself; dispatches approve/reject/undo) |
| `GuardrailList` | `{items}` |
| `DiffTable` | `{rows}` |
| `AllocationBar` | `{parts:[{key,label,share}], previous?}` |
| `ImpactBadge` | `{impact, realized?}` |
| `TraceView` | `{auditId}` |
| `AgentPulse` | `{compact}` |
| `AutonomyControl` | `{agentId}` |

### 8.3 Charts (`MC.charts.*`, `ch-` classes)

All charts are responsive via `useWidth`, carry `role="img"` and an `aria-label` summary, offer a `View as table` toggle, and color only through tokens.

| Chart | Props |
|---|---|
| `Sparkline` | `{values, width=96, height=24, color, area, ariaLabel}` |
| `LineChart` | `{series:[{id,label,color,points:[{x,y}],dashed}], band?:{points:[{x,lo,hi}]}, band95?, forecastFrom?, goal?:{y,label}, markers?:[{x,kind:'agent'\|'anomaly'\|'event',label,onClick}], cumulative?, xFormat, yFormat, height=240, ariaLabel}` |
| `ForecastChart` | LineChart preset `{actual, forecast, goal, nowX, cumulative}` |
| `BarChart` | `{data:[{key,label,value,ci?,color?}], orientation:'h'\|'v', format, highlightKey}` |
| `StackedBar` | `{rows:[{key,label,parts:[{key,value}]}], keys:[{key,label,color}], format}` |
| `Funnel` | `{stages:[{key,label,value}], format}` |
| `Histogram` | `{bins:[{x0,x1,count}], height=56, color, format}` |
| `HourStrip` | `{values:number[24], highlight?, quiet?:[start,end]}` |
| `Heatmap` | `{rows, cols, values, format, onCell}` |
| `ResponseCurve` | `{curve:{A,B}, current, proposed?, maxSpend, format}` (annotates marginal return) |
| `ScoreRing` | `{value, size=40, label}` |
| `FlowDiagram` (flow.js) | `{steps, stats:{[stepId]:{inStep,sentToday,branchPct}}, tags:{[stepId]:{agentId,text}}, selectedId, onSelect, orientation:'auto'}`. Layout: BFS-layered columns with branch rows. |
| `Gantt` (flow.js) | `{rows:[{id,label,start,end,status}], now, markers:[{x,label}], onSelect, from, to}` |

---

## 9. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Load-order coupling between classic scripts and parallel builders | Every file uses `window.MC = window.MC \|\| {}`; no cross-builder lookups at load time; `MC.contract.check()` dev panel; ErrorBoundary per view with a "still being built" fallback |
| 2 | htm pitfalls (`class` vs `className`, `for` → `htmlFor`, components need `<${X}>…<//>`, numeric style values) | Kit examples at the top of kit.js. React-only attribute names. No raw HTML strings (no `dangerouslySetInnerHTML`). |
| 3 | `useSyncExternalStore` infinite loops from fresh objects | Only `useSelect` with a cached snapshot. Derived data via memoized `MC.select.*` keyed on `rev`. |
| 4 | Mutable typed arrays cause stale renders | `rev.*` counters bumped by sim; selectors key on rev |
| 5 | Determinism leaks (`Math.random`, `Date`, `performance.now`, object key order, unstable sorts) | Banned outside engine.js and timing fields (`_ms`, excluded from digests). Iterate via `order` arrays. Non-numeric ids. `stableSort` with id ties. `MC.dev.selfTest` greps function sources for banned tokens. |
| 6 | Float drift breaking digests | Same engine on replay; canon at 12 significant digits; typed arrays hashed as bytes |
| 7 | Replay cost (~300ms generate + N ticks) | Chunked 20 ticks per frame with progress; sim paused during verify (UI note: "Simulation paused while verifying") |
| 8 | Agent noise erodes trust | Materiality, supersede, cooldowns, 48h expiry, per-agent notify levels, one coalesced toast per tick |
| 9 | Agents clobbering marketer work | `protectDrafts` immutable; agents never emit `variant/update` or `segment/update`; `baseVer` freshness; conflict chips |
| 10 | Undo after subsequent changes | Undo only when the version matches; otherwise an explained disabled state and a link to adjust manually |
| 11 | Performance at 16× (75ms budget) | Send caps, daily-ordered enrollment, cadence phases spread agents, Scout limited to 48h; overrunning ticks skip |
| 12 | Hosted-artifact limits | No fetch, iframes, downloads or dialogs; bare hash tokens only; all localStorage in try/catch; fonts via Google Fonts only |
| 13 | CSS collisions between parallel builders | Scoped roots `.v-*`; kit `k-`, charts `ch-`, shell `app-`; views use tokens only |
| 14 | Calibration: agents don't visibly move KPIs | Latent ε gives the bandit an edge; budget-capped propensity ordering creates real curves; control cohort shows measured lift; the selfTest prints with-agents vs agents-off attainment over 14 simulated days |
| 15 | Trademark leakage | Copy deck is the source of truth for labels; review step greps for the inspiration vendor's product names before publish |
| 16 | Phone layout overflow | Every wide table and chart sits in an `overflow-x:auto` wrapper; FlowDiagram switches to top-to-bottom under 640px; drawer becomes a full sheet |