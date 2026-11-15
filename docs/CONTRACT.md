> **Binding build contract.** Derived from the marketer-workflow architecture proposal. Section 10 (Amendments), when present, overrides anything earlier in this document.

# Kestrel Marketing Cloud: Architecture Proposal (Marketer-Workflow Lens)

This is a binding contract for 13 parallel builders (lanes in §10.1). It covers the whole system and goes deepest on what the marketer sees and does. **Read §10 before writing any code**; it resolves every known inconsistency below.

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

**index.html (order summary only; the complete literal file is §10.2 and binds)**

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
MC.store.applyInternal(action, origin)    // live-world wrapper of MC.catalog.apply (§10.3); sim/runtime code calls
                                          // MC.catalog.apply(world, …) on the world it was given, never the store
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
MC.segments.parse(text, world) -> { rule, matched:[{phrase, attr, label, cond}], ignored:string[], confidence }  // world needed for percentile phrases
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
  meta: { seed, tick, tenant:'Fernway Outfitters', sample:true, day0:-60,
          monthGoal:{revenue:140000, conversions:1500, roas:3.0, unsubRate:0.0025} },   // applies to every calendar month (§10.8)
  modelState: { coef:Float64Array(8), snap:Float32Array(n*8), snapDay },                // propensity fit state (§10.8)
  seq: 0,                                      // id counter (reducers only)
  rev: { profiles, metrics, enroll, segCounts },// bump when mutable columns change
  catalog: { categories:[{id,label}] /*5 objects, order per §10.10*/, products:[{id,name,cat,price,margin}] /*24*/ },
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
  // metrics.days[MC.time.dayIndex(d)] (index = d − day0, never a negative index); full entry shape in §10.4
  metrics: { days:[ { day, tot:Fact, org:Fact, c:{ [cid]:{ tot, trt:{[ch]:Fact}, ctl:{[ch]:Fact}, ch:{[ch]:Fact}, v:{[vid]:Fact}, attrLast:{[ch]:$}, attrLin:{[ch]:$}, steps:{[stepId]:[sent,yes,no]} } } } ],
             hours:{ [cid]:{ [ch]: Float64Array(48) /*sends[24],opens[24], decayed 0.9/day*/ } } },
  // Fact = Float64Array(10): [sent, delivered, opens, clicks, conv, revenue, cost, unsubs, impressions, react]
  //   index constants MC.F = {SENT:0,DELIV:1,OPEN:2,CLICK:3,CONV:4,REV:5,COST:6,UNSUB:7,IMPR:8,REACT:9} (namespace.js)
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
  budget:{ total, byChannel:{[ch]:$} }, alloc:{ [ch]:{ [vid]:share } },
  sendHour:{ [ch]: 0..23 | 'adaptive' }, journey:{ steps:[Step] }, holdoutPct, createdBy, brief, createdTick,
  // §10.4 additions (initialAlloc is REMOVED; the control cohort reads ctl.*):
  ctl:{ alloc, sendHour, channelPaused }, include:[segmentId], channelPaused:{[ch]:bool},
  updatedBy:'user'|'agent:<id>'|'sim', updatedTick, eventDay:null|int }
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
| `campaign/setSegment` | `{id, segmentId}` | user (agents use `campaign/include`, §10.5) | prior |
| `campaign/setJourney` | `{id, steps}` | user | prior steps |
| `campaign/setAlloc` | `{id, channel, alloc}` | user, agent:optimizer, agent:copy | prior alloc |
| `campaign/setSendHour` | `{id, channel, hour\|'adaptive'}` | user, agent:sendtime | prior |
| `campaign/setBudget` | `{id, byChannel}` (total preserved for agents) | user, agent:pacer | prior |
| `campaign/setEnd` | `{id, endTick}` | user, agent:analyst | prior |
| `campaign/suppress` | `{id, segmentId, on}` | user, agent:guard | toggle |
| `campaign/remove` | `{id}` (draft only) | user | create(snapshot) |
| `variant/create` | `{variant, share?, tmpId?}` (`share` 0–1: new variant gets it, other live variants scaled pro rata) | user, agent:copy | `variant/setStatus retired` + prior alloc |
| `variant/update` | `{id, fields}` (user only; live → "save anyway" path) | user | prior fields |
| `variant/setStatus` | `{id, status}` | user, agent:optimizer | prior (+ alloc restore) |
| `segment/create` / `update` / `remove` | `{segment}` / `{id, name?, rule?}` / `{id}` | user, agent:scout (create) | remove / prior / create |
| `profiles/suppress` | `{channel, idx[], untilTick, campaignId}` | agent:guard, user | `profiles/release {channel, idx[], prev[]}` |
| `profiles/release` | `{channel, idx[], prev?:int[]}` (sets `supUntil` to `prev[k]`, or 0 when absent) | user | release(with the before-values as `prev`) |
| *(more rows and payload changes in §10.5)* | | | |
| `agent/setAutonomy` / `setStatus` / `setCadence` / `setParams` / `resetParams` | `{id, …}` (validated against def ranges) | user | n/a |
| `agent/runNow` | `{id}`: sets `runRequested`, runs at the next tick | user | n/a |
| `proposal/approve` | `{id}`: re-checks guardrails and `baseVer`; stale → status `stale` | user | via `undo` |
| `proposal/approveMany` | `{ids}` | user | n/a |
| `proposal/reject` | `{id, reason:'not-now'\|'wrong'\|'other'}`: cooldown 24h / 7d / 24h | user | n/a |
| `proposal/undo` | `{id}`: allowed only if every target `ver` still equals its post-apply ver | user | n/a |
| `guardrails/update` | `{patch}` (`protectDrafts` and consent immutable) | user | n/a |
| `insight/dismiss` | `{id}` | user | n/a |

Sim and runtime internals are never logged: `sim/status`, `sim/enroll`, `sim/rescore`, `runtime/propose`, `runtime/autoApply`, `runtime/expire`, `runtime/supersede`, `runtime/realize`, `runtime/recordRun`. These are descriptive names for internal operations, **not** catalog types: the sim changes campaign status through `MC.catalog.apply(world, {type:'campaign/setStatus',…}, {origin:'sim'})`; the runtime mutates `proposals`/`agents`/`feed`/`insights`/`audit` directly on the world it was given (copy-on-write, §10.4).

**Replay ordering.** A user action dispatched while the clock shows tick T is stamped `T`.

- Live run: process tick T, then the user acts, then process tick T+1.
- Replay: for t = 1..N, apply log entries stamped t−1 in `seq` order, then `tickOnce()`. After the loop, apply entries stamped N.

---

## 5. Simulation and model math

### 5.1 Tick pipeline (`engine.tickOnce`, inside `store.batch`) — superseded by §10.6 (exact order) and §10.7 (caps, send window, control cohort)

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
   - Caps: 600 sends per campaign per tick, 1,500 global per tick (§10.7; the old 150/600 made owned volume cap-bound instead of budget-bound).
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

`offerLift`, `discount`, `spam_v`, product resolution and the exact latent-quality formula are defined in §10.7.

**Variant latent quality:** `q = 0.8 × (copy.score contributions on the same feature scale) + ε`, where `ε ~ N(0, 0.25)` is drawn from `fork(seed,'variant',vid)` (exact definition: §10.7). The predicted score is mostly right, which leaves room for the bandit to add value. When a variant's text is edited, q is recomputed from the new features with the same ε.

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
| Predicted LTV (12 mo) | `orders · 365 / max(tenure, 90) · aov · (1 − churn)`, clipped to the p99 of the current scores (`engRate30` everywhere in this table means `engRate`, §10.8) |
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

### 5.5 Performance budget (superseded by §10.12)

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

**Runtime per run** (summary; the exact algorithm, `decide` output with `insights`, and the extra def fields `autopilotMaxRisk`, `preview`, `cadence.min/max` are in §10.9):

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

- **Observe:** each live campaign × owned channel with ≥ 2 live variants. Uses lifetime `{sends, conv, clicks, revenue}` per variant from `metrics.days[*].c[cid].v[vid]` (both cohorts; variant quality does not depend on cohort), the current treatment `alloc`, `predicted`, and the goal type.
- **Decide:**
  1. Reward: conversions per send (revenue, conversion and reactivation goals) or clicks per send (engagement and launch goals).
  2. Prior `Beta(1 + k·p̂, 1 + k·(1−p̂))`, where p̂ is the predicted rate.
  3. Compute `pBest` from `probBest(draws)`, then `target = max(minShare, pBest)` normalized.
  4. Step: `new = old + clamp(target − old, ±maxShift)`, renormalized.
  5. Emit only if `Σ|Δ|/2 ≥ 0.05`.
  6. Pause a variant if `pBest < pauseBelow`, its sends ≥ `minSample`, and ≥ 2 others are live.
- **Impact:** `Σ Δshare·rate × projected sends over horizonDays × AOV` (for every agent `impact.horizonDays = horizon/24`; 3 days for the Optimizer, §10.9), with the band from posterior SD.
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
  - If z ≥ `unsubZ`, emit `pause-channel` (always queued, risk high). Action: `campaign/setChannelPaused {id, channel, paused:true}` (§10.5).
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

- **Trigger:** the leader's 3-day CTR ≤ (1 − `decayThreshold`) × its peak, **or** the leader's pBest ≥ 0.9 (computed by the Copy Drafter itself with `MC.models.probBest` on `Beta(1+conv, 1+sends−conv)`, 400 draws, its own rng; agents never read another agent's audit), **and** live variants < `maxVariants`.
- **Decide:**
  1. `MC.copy.generate({…campaign tone/product/offer, count: candidates, seedKey:'copy:'+cid+':'+ch+':'+t})`.
  2. Drop any brand `fail`, and drop near-duplicates (feature distance < 0.2).
  3. Take the best score.
  4. Action: one `variant/create {variant, share: challengerShare}` (author `agent:copy`, status live); the reducer takes the share pro rata from the other live variants (§10.5). No separate `setAlloc` is needed because the new id is unknown until apply.
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
  - Optional `retarget` ("Add to Winter Layering Launch audience") is always queued (`mustQueue`). Actions: `segment/create {segment, tmpId:'$1'}` then `campaign/include {id, segmentId:'$1', on:true}` (§10.5). It never replaces the authored segment.
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
- **Weekly run:** if a `MC.time.EVENTS` day within 21 days has no campaign, emit `campaign-draft` ("Draft: Cyber Monday follow-up for Black Friday browsers"). "Has no campaign" and the plan/brief shapes are defined exactly in §10.9; journey templates live in core as `MC.data.journeyTemplate` (§10.7), not in planner.js.
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
Expected   +$810 revenue over 3 days ($530–$1,090) · confidence 82%
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
| Forecast | Headline: "November revenue is on pace for **$148k** ($133k–$163k), 6% above the $140k goal." (Projection rule: §10.8.) ForecastChart in cumulative mode (actual solid, forecast dashed, 80% band, goal line, today marker). Below: "Biggest movers this week", 3 rows such as "+$2.1k Winter Layering Launch · after Variant Optimizer shift (Nov 9)". |
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
- The Holiday Gift Guide draft opens here via `Continue planning` (brief prefilled from `campaign.brief`). When the planner is editing an existing draft, the final button reads `Save plan to draft` and dispatches `campaign/applyPlan` (§10.5) instead of `campaign/create`.
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
- **Soft tints (light/dark):** accent-soft `#E3ECF4` / `#1E2E3F`; agent-soft `#F6E6DD` / `#3A2419`; ink-3 `#65717C` / `#8C99A6` (full palette for every token: §10.13).
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

---

## 10. Amendments (binding — overrides earlier sections)

**Precedence.** §10 overrides §0–§9. Where §10 renames, reshapes or adds something, the earlier text is void for that item. Numbers inside example copy (titles, headlines, card mock-ups) are illustrative; formulas, shapes, ids and constants bind.

### 10.1 Builders, lanes and file ownership

There are **13 builders**. Each file has exactly one owner. Reference lanes (if the orchestrator assigns lanes differently, its assignment wins; the APIs in this document bind regardless of who writes them):

| Lane | Files |
|---|---|
| L1 core-foundation | `js/core/namespace.js`, `util.js`, `time.js`, `rng.js`, `catalog.js`, `store.js` |
| L2 core-models | `js/core/models.js`, `segments.js` |
| L3 core-data | `js/core/copy.js`, `data.js` |
| L4 core-sim | `js/core/guardrails.js`, `sim.js`, `select.js` |
| L5 core-runtime | `js/core/runtime.js`, `engine.js`, `replay.js` |
| L6 ui-kit | `css/tokens.css`, `css/app.css`, `js/ui/icons.js`, `js/ui/kit.js` |
| L7 ui-viz | `js/ui/charts.js`, `js/ui/flow.js`, `js/ui/agent-ui.js` |
| L8 agents-a | `js/agents/optimizer.js`, `sendtime.js`, `pacer.js`, `guard.js` |
| L9 agents-b | `js/agents/scout.js`, `copy.js`, `analyst.js`, `planner.js` |
| L10 shell + home | `index.html`, `js/app.js`, `css/views/home.css`, `js/views/home.js` |
| L11 campaigns | `css/views/campaigns.css`, `js/views/campaigns.js` |
| L12 content + audiences | `css/views/content.css`, `css/views/audiences.css`, `js/views/content.js`, `js/views/audiences.js` |
| L13 analytics + agents | `css/views/analytics.css`, `css/views/console.css`, `js/views/analytics.js`, `js/views/console.js` |

Rules every lane follows:

- Never edit files outside your lane, nor anything under `tools/`, `.claude/` or `docs/`.
- If an API you need is missing at runtime, do not define it in someone else's namespace. Guard the call (`typeof MC.x.y === 'function'`), render a neutral fallback, and keep calling the contract name.
- Files are UTF-8 without BOM. In JS string literals prefer `\u` escapes for non-ASCII glyphs (`·` ·, `–` –, `→` →, `×` ×, `…` …). htm template text may contain them literally.
- Every JS file is the §2 IIFE with `'use strict'`. Nothing at top level outside it. No `type="module"`, `import`, `export`, JSX, TypeScript, `eval`, `new Function`, `with`.
- Load time may only create the file's own buckets/functions. Agents call `MC.runtime.register(def)` at load (runtime.js loads earlier); `register` only stores the def.
- Each view is a React function component `MC.views.<route>` taking no required props. Its root is `<section className="v-<route>">` (`v-agents` for console.js) and it renders exactly one `<h1 id="page-title" tabIndex="-1">`. app.js focuses `#page-title` after a route change, never on a tick.
- All components in `agent-ui.js` attach to `MC.ui` (`MC.ui.AgentChip`, `MC.ui.ProposalCard`, `MC.ui.GuardrailList`, `MC.ui.DiffTable`, `MC.ui.AllocationBar`, `MC.ui.ImpactBadge`, `MC.ui.TraceView`, `MC.ui.AgentPulse`, `MC.ui.AutonomyControl`). `icons.js` provides `MC.icons` (name → SVG path data) plus `MC.ui.Icon({name, size=16, title})` and `MC.ui.Scene({imageId, title})`, which renders the 6 synthetic illustrations of `MC.copy.IMAGES`. The ErrorBoundary is a class component inside app.js.

### 10.2 index.html (complete literal file; L10 writes exactly this)

No doctype/html/head/body, no inline scripts, no `defer`/`async` (classic scripts must execute in this order). The viewport meta tag is required so phone emulation lays out at device width. Every file in §2 appears exactly once.

```html
<title>Kestrel Marketing Cloud</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/app.css">
<link rel="stylesheet" href="css/views/home.css">
<link rel="stylesheet" href="css/views/campaigns.css">
<link rel="stylesheet" href="css/views/content.css">
<link rel="stylesheet" href="css/views/audiences.css">
<link rel="stylesheet" href="css/views/analytics.css">
<link rel="stylesheet" href="css/views/console.css">
<div id="app"><div class="app-boot" role="status">Generating the Fernway sample world…</div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js"></script>
<script src="js/core/namespace.js"></script>
<script src="js/core/util.js"></script>
<script src="js/core/time.js"></script>
<script src="js/core/rng.js"></script>
<script src="js/core/catalog.js"></script>
<script src="js/core/store.js"></script>
<script src="js/core/models.js"></script>
<script src="js/core/segments.js"></script>
<script src="js/core/copy.js"></script>
<script src="js/core/data.js"></script>
<script src="js/core/guardrails.js"></script>
<script src="js/core/sim.js"></script>
<script src="js/core/select.js"></script>
<script src="js/core/runtime.js"></script>
<script src="js/core/engine.js"></script>
<script src="js/core/replay.js"></script>
<script src="js/ui/icons.js"></script>
<script src="js/ui/kit.js"></script>
<script src="js/ui/charts.js"></script>
<script src="js/ui/flow.js"></script>
<script src="js/ui/agent-ui.js"></script>
<script src="js/agents/optimizer.js"></script>
<script src="js/agents/sendtime.js"></script>
<script src="js/agents/pacer.js"></script>
<script src="js/agents/guard.js"></script>
<script src="js/agents/scout.js"></script>
<script src="js/agents/copy.js"></script>
<script src="js/agents/analyst.js"></script>
<script src="js/agents/planner.js"></script>
<script src="js/views/home.js"></script>
<script src="js/views/campaigns.js"></script>
<script src="js/views/content.js"></script>
<script src="js/views/audiences.js"></script>
<script src="js/views/analytics.js"></script>
<script src="js/views/console.js"></script>
<script src="js/app.js"></script>
```

app.js, when it executes (all scripts are loaded by then): reads uiStore, applies the theme attribute, mounts `ReactDOM.createRoot(document.getElementById('app'))`, then calls `MC.engine.boot({seed: MC.SEED, onPhase})`. Boot phases are shown in the boot card. If `React`, `ReactDOM` or `htm` is undefined, app.js replaces the boot text with "Couldn't load the interface libraries. Check your connection and reload." and stops.

### 10.3 API additions and signature fixes (all added to `MC.contract.REQUIRED`)

```js
// ── namespace.js (L1)
MC.contract = { require, check, REQUIRED };   // created here; buckets are created with `MC.x = MC.x || {}` (never overwrite)
// buckets: views agents ui charts icons hooks dev planner
MC.CH = { ALL:['email','sms','push','social','web'], OWNED:['email','sms','push'], PAID:['social','web'],
          IDX:{email:0,sms:1,push:2,social:3,web:4}, BIT:{email:1,sms:2,push:4,social:8,web:8},
          LABEL:{email:'Email',sms:'SMS',push:'Push',social:'Social ads',web:'Web ads'} };   // MC.data.CHANNELS === MC.CH.ALL
MC.F = { SENT:0, DELIV:1, OPEN:2, CLICK:3, CONV:4, REV:5, COST:6, UNSUB:7, IMPR:8, REACT:9, LEN:10 };
// REQUIRED = every function path in §3 and §10.3, every MC.ui name in §8.2 and §10.1, every MC.charts name in §8.3,
// and MC.views.{home,campaigns,content,audiences,analytics,agents}. check() also reports agent ids missing from
// MC.runtime.defs() (expected: optimizer sendtime pacer guard scout copy analyst planner).

// ── util.js (L1)
MC.util.now() -> ms              // the ONLY caller of performance.now(); its result may flow only into `_ms`/`ms` fields and UI text
MC.util.hex8(u32) -> 'xxxxxxxx'  // lowercase, zero-padded
MC.util.normCdf(z) -> p          // Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7
MC.util.bump(world, ...keys)     // world.rev[k]++ on the GIVEN world (sim/models/runtime use this, never MC.store.bump)
// canon(v), fnv1a, digest: exact rules in §10.11. MC.fmt.* must be locale-independent (no Intl, no toLocaleString).

// ── time.js (L1)
MC.time.DAY0 = -60; MC.time.dayIndex(d) -> d - DAY0;  dayOf(t) = Math.floor(t/24); hourOf(t) = ((t % 24) + 24) % 24
MC.time.ymd(day) -> '2026-11-07'; MC.time.dayOfYmd('2026-11-07') -> 0      // for <input type="date">; pure arithmetic
MC.time.monthOf(day) -> { y, m, label:'Nov', fromDay, toDay }             // Nov 2026 = {fromDay:-6, toDay:23}
MC.time.simDay(t) -> dayOf(t) + 1                                         // "Sim day 1" at tick 0
MC.time.inQuiet(h, quiet) -> bool   // start > end ? (h >= start || h < end) : (h >= start && h < end)
MC.time.EVENTS (unchanged): Thanksgiving day 19 = Thu Nov 26, Black Friday 20, Cyber Monday 23

// ── rng.js (L1)
// fork(seed, ...keys) = create((seed ^ fnv1a(keys.map(String).join('|'))) >>> 0). Rng.float() = next()/4294967296.
// normal: Box–Muller using 2 fresh draws per call (NO cached spare). gamma: Marsaglia–Tsang (k<1 via boost).
// beta(a,b) = X/(X+Y) of gammas. binomial: n<=40 → n Bernoullis, else round(normal(np, sqrt(np(1-p)))) clamped [0,n].
// poisson: lam<=30 → Knuth, else max(0, round(normal(lam, sqrt(lam)))). Every method consumes a fixed draw pattern.

// ── catalog.js (L1)
MC.catalog.apply(world, action, meta) -> { ok, error?, created?:string[] }   // meta = { origin, tick }
//   origin: 'user' | 'sim' | 'runtime' | 'agent:<id>'. Validates (origin must be allowed by def.by), reduces, bumps ver.
MC.catalog.dispatchUser(world, action) -> { ok, error?, created? }   // origin 'user', tick = world.meta.tick; on success
//   appends world.log entry { seq: world.log.length + 1, tick, type, payload } and a 'user' feed item; on failure logs nothing.
MC.catalog.inverse(world, action) -> action[]        // ALWAYS an array (possibly empty); computed at apply time
// define(type, def): def.by is an array of origins, e.g. ['user','agent:copy']; 'agent:*' allows every agent.

// ── store.js (L1)
MC.store.dispatch(action) = catalog.dispatchUser(liveWorld, action) + one microtask notify. Returns { ok, error?, created? }.
MC.uiStore state shape: §10.13.

// ── models.js (L2)
MC.models.explain(world, i, which:'prop'|'churn'|'ltv') -> [{label, delta}]   // signed contributions for "Why" popovers
MC.models.unsubRisk(world, i, ch) = σ(−7 + .55·F_i + .8·[sent7_i,ch ≥ freqCap[ch]−1] − 1.2·engRate_i)

// ── segments.js (L2)
MC.segments.eliminations(world, rule) -> [{path, label, remaining, removedPct}]  // per leaf: count with that leaf removed
MC.segments.nameFor(rule) -> string (≤ 48 chars, e.g. "Summit-tier hikers, Pacific Northwest")
// Rule format and ATTRS keys: §10.10.

// ── copy.js (L3)
MC.copy.generate(opts, seed = MC.SEED) -> VariantDraft[]   // rng = fork(seed, 'copy', opts.seedKey); pure
//   VariantDraft = { tmpId:'$v0'.., channel, name:'A'.., fields, tone, offer, productId, predicted:{score, open, click} }
MC.copy.score(variant, ctx?) -> { score, predOpen, predClick, logitO, logitC, contributions }
MC.copy.BANK_STATS -> { meanO, sdO, meanC, sdC }   // computed lazily on first use from ≤ 2,000 bank combinations
MC.copy.HOOK = { email:'subject', sms:'sms', push:'pushTitle', social:'socialHeadline', web:'socialHeadline' }
MC.copy.IMAGES = [{id:'scene-summit'},{id:'scene-forest'},{id:'scene-campfire'},{id:'scene-trail'},{id:'scene-snow'},{id:'scene-lake'}]
//   each also has { label, alt }. Brand check uses guardrails.brand.maxSubject (user-editable) instead of LIMITS.subject.

// ── data.js (L3)
MC.data.generate(seed) -> World   // world at tick 0, no tick processed, no agent run
MC.data.generateSteps(seed) -> { next() -> { done, phase:'profiles'|'history'|'scores', world? } }  // same result as generate
MC.data.journeyTemplate(goalType, channels) -> Step[]   // §10.7; used by data.js AND the planner
MC.data.REGIONS, STATES, CATEGORIES, TIERS, PRODUCTS (§10.10); MC.data.NEVER = -9999 (lastOrder sentinel)

// ── guardrails.js (L4)
MC.guardrails.preflight(world, campaignLike) -> [{id, label, status:'pass'|'warn'|'fail', detail}]
//   checks: consent coverage ≥ 50% on the primary channel, segment set, ≥1 live-or-draft variant per owned channel,
//   brand (copy.check fails → fail), quiet hours, budget > 0 and daily ≤ maxDailySpend, frequency-cap collisions
//   with live campaigns (warn), start ≥ now+1 (fail). Planner section 6 and campaign/setStatus→scheduled both use it.

// ── sim.js (L4)
MC.sim.CONST    // every calibration constant of §10.7 in one object; only L4 tunes values
MC.sim.HOUR_SHAPE   // Float64Array(24), §10.7
MC.sim.latentFor(world, variant) -> { qo, qc, qv }    // called by the variant/create and variant/update reducers
MC.sim.dailyBudget(world, cid, ch, day) -> $          // §10.7; used by sim, Pacer, views
MC.sim.enroll(world, cid, tick)                        // go-live enrollment; also used by data.generate
MC.sim.step(world, tick); MC.sim.dayRoll(world, day)   // both operate only on the given world

// ── select.js (L4) — memoized; return shapes in §10.13
MC.select.movers(w) insights(w,{kinds, includeDismissed}) journeyStats(w,cid) profileRow(w,i) previewProfiles(w)
MC.select.variantLibrary(w) campaignGoal(w,cid)

// ── runtime.js (L5)
MC.runtime.preview(agentId, input, world = MC.store.getState()) -> { proposals, trace, plan? }   // calls def.preview
MC.runtime.apply(world, proposalId, origin)          // used by proposal/approve and autopilot; §10.9
MC.runtime.undoCheck(world, proposalId) -> { ok, reason?, by?, tick? }
MC.runtime.runAgent(world, agentId, tick, reason:'schedule'|'runNow')

// ── engine.js (L5)
MC.engine.advance(world) -> world      // ONE tick on the given world, no store access (live and replay share it)
MC.engine.tickOnce()                   // store.batch(() => advance(live)); checkpoint at day roll; one notify
MC.engine.checkpoints                  // { [tick]: stateDigest } live-only, outside the world; reset on restart
MC.engine.boot({seed, onPhase}) -> Promise; setSpeed/getSpeed/step/restart/lastTickMs as in §3

// ── replay.js (L5): algorithm in §10.11
```

### 10.4 State shape amendments

**Mutation model (binding for every core file).**

- Entity slices (`meta`, `segments`, `campaigns`, `variants`, `agents`, `proposals`, `feed`, `insights`, `audit`, `guardrails`, `log`) are copy-on-write. A change replaces the changed entity object, its `byId` map, any changed `order`/`open` array, and the slice object, then assigns the new slice onto the same `world` object. Never mutate an entity object, `byId` map or array that has been published.
- Columnar data (`profiles`, `enroll`, `metrics`, `latent`, `modelState`) is mutated in place, followed by `MC.util.bump(world, key)`.
- `world.rev = { profiles, metrics, enroll, segCounts }` is excluded from digests.
- Caches stored on the world must use keys starting with `_` (for example `world._segCache`); canon drops them.
- Selectors passed to `useSelect` return primitives, existing slice/entity references, or `MC.select.*` results. Never select the whole world. Anything else must pass `eq = MC.util.shallowEqual`.

**Ids.** Seeded entities use the readable ids of §10.10. Entities created later get `c-<n>` / `v-<n>` / `s-<n>`, where `n = ++world.seq` (the id counter, which only reducers touch). Feed ids are `f-<n>`, also from `world.seq`. Proposal ids are `${agentId}-${tick}-${k}`, insight ids `${agentId}-${tick}-i${k}`, audit ids `run-${agentId}-${tick}`. A log entry's `seq` is its 1-based position in `world.log` and is unrelated to `world.seq`. `campaigns.all` is an append-only array of every campaign id ever created; `profiles.touchC` stores an index into it, so removing a draft never shifts touch data.

**Typed-array layouts** (i = profile index, ch = `MC.CH.IDX`, d = day):

| Column | Layout |
|---|---|
| `aff` | `i*5 + catIdx` (category order §10.10), values 0–1 |
| `sent7` | `i*21 + ch*7 + ((d % 7) + 7) % 7` (owned channels only), saturating at 255 |
| `supUntil` | `i*3 + ch`; suppressed while `supUntil > t`; 0 = not suppressed |
| `eng` | `i*9 + ch*3 + k` with k = 0 sent, 1 open, 2 click; lifetime counts, saturating at 65,535 |
| `openHr` | `i*24 + h`, saturating at 255 |
| `touchC` / `touchCh` / `touchT` | `i*8 + slot`; ring write position `tPtr[i]` (0–7); `touchC = -1` means an empty slot |
| `latent.profiles.cf` | `i*5 + MC.CH.IDX[ch]` (all 5 channels) |
| `consent`, `unsub` | bitmask `MC.CH.BIT` (ads bit 8 covers social and web). A send requires consent bit set and unsub bit clear |
| `lastOrder` | day of last order, or `MC.data.NEVER` |
| `bestCh` | 0/1/2 = owned channel index, 255 = no consented owned channel |

**metrics.** `metrics.days[dayIndex(d)] = { day:d, tot:Fact, org:Fact, c:{ [cid]: CampaignDay } }`. The array holds days −60..−1 plus day 0 at boot, and the day roll pushes one empty entry per new day. `tot` covers everything: organic, campaign sends and paid. `org` is organic orders only (conv, revenue, react).

`CampaignDay = { tot, trt:{[ownedCh]:Fact}, ctl:{[ownedCh]:Fact}, ch:{[ch]:Fact}, v:{[vid]:Fact}, attrLast:{[ch]:$}, attrLin:{[ch]:$}, steps:{[stepId]:[sent, yes, no]} }`.

- `ch` covers both cohorts plus paid. `tot` is the sum of `ch`.
- An entry exists for each campaign that is live or paused on that day, and for history days of completed campaigns.
- `metrics.hours[cid][ch]` = Float64Array(48): sends by hour in [0..23], opens by hour in [24..47]. It is decayed ×0.9 at each day roll.

**enroll.** `enroll[cid] = { step:Int16(n), due:Int32(n), ctl:Uint8(n), flags:Uint8(n), rev:Float32(n), order:Int32Array, entered, exited }`.

- `step` is an index into `campaign.journey.steps`. −1 means never enrolled; −2 means exited.
- `rev` is the campaign revenue attributed directly to each profile. Analyst ROI by segment uses it.
- The ads-sampling cumulative table lives at `enroll[cid]._ads` (a cache, excluded from digests).

**Entity additions.**

- **Campaign:** see the §4 comment. The `ctl` fields hold the **user-authored policy** the control cohort follows (§10.5). `include` lists extra entry segments. `channelPaused[ch] = true` stops treatment sends and paid spend on that channel. `holdoutPct` is copied from `guardrails.holdoutPct` at create time.
- **Variant:** adds `ctlStatus` (the status as the control cohort sees it), `updatedBy`, and `updatedTick`.
- **Segment:** adds `countHist:number[]` (the last 8 daily counts, oldest first), `updatedBy`, and `updatedTick`.
- **Proposal:** adds `appliedTick`, `postVer:{[entityId]:ver}`, `horizon` (ticks; default `def.horizon`), `mustQueue`, `impact.tradeoff?:{metric, delta, unit}`, `realized.method:'did'|'diff'|'model'|'window'`, and `inverse` (set at apply time).
- `world.proposals.open` = pending ids, newest first.

### 10.5 Action catalog amendments

**Origins and the control mirror.** Fields with a control mirror are `campaign.alloc ↔ ctl.alloc`, `campaign.sendHour ↔ ctl.sendHour`, `campaign.channelPaused ↔ ctl.channelPaused`, and `variant.status ↔ variant.ctlStatus`.

- A reducer running with origin `user` writes both the field and its mirror.
- Origins `agent:*` (approved, autopilot, and undo of an agent proposal) write only the treatment field.
- Everything else (segment, journey, budget, dates, content, suppress lists) is shared by both cohorts.
- The `holdout` guardrail therefore passes by construction for catalog actions. It fails only if a draft writes a `ctl` field directly.

**Every reducer:**

- increments `ver` on each entity it changes;
- sets `updatedBy` (the origin) and `updatedTick`;
- returns `created` ids in creation order.

**Temporary ids.** Inside one dispatched action or one proposal, `campaign/create`, `variant/create` and `segment/create` may carry `tmpId:'$1'` (variants inside `campaign/create` use `'$v0'`, `'$v1'`, …). Later references in the same payload or proposal (alloc keys, `segmentId`) use the tmpId. The runtime and reducer substitute real ids as they are assigned.

**Status transitions** (anything else fails validation):

| From → To | Origin | Requires |
|---|---|---|
| draft → scheduled | user | `MC.guardrails.preflight` has no `fail` |
| scheduled → draft | user | — |
| scheduled → live | sim | `startTick ≤ t`; calls `MC.sim.enroll` |
| live ↔ paused | user | — |
| live/paused → completed | user (End campaign), sim (`endTick ≤ t`) | — |

**Added or changed types:**

| Type | Payload | By | Inverse |
|---|---|---|---|
| `campaign/include` | `{id, segmentId, on}`: adds or removes an extra entry segment; members enroll at the next day roll | user, agent:scout | toggle |
| `campaign/setChannelPaused` | `{id, channel, paused}` | user, agent:guard | prior value |
| `campaign/applyPlan` | `{id, campaign, variants[]}`: replaces a **draft**'s plan fields and its variants (old ones become `retired`); keeps `id` | user | prior snapshot |
| `campaign/create` | `{campaign, variants[], segment?}` (optional `segment` is created first and `campaign.segmentId:'$1'` refers to it) | user, agent:planner | `campaign/remove` |
| `variant/setStatus` | `{id, status}`. Leaving `live` sets the variant's share to 0 in `alloc[ch]` and renormalizes the rest pro rata. Entering `live` adds no share | user, agent:optimizer | prior status + prior alloc |
| `segment/remove` | `{id}`: fails while any non-completed campaign uses it as `segmentId`, `include` or `suppress` | user | `segment/create` (snapshot, same id) |

**Proposal actions:**

- `proposal/approve {id}`:
  - Not pending → fails (nothing logged).
  - `baseVer` mismatch → status `stale` with reason "No longer applies: the campaign changed since this was proposed." This counts as success and is logged.
  - Otherwise guardrails are re-evaluated. A blocking failure fails the dispatch with "Blocked by guardrail: {label}" and the proposal stays pending.
  - Otherwise `MC.runtime.apply(world, id, 'agent:'+agentId)`, then status `applied` and a feed item of kind `approved`.
- `proposal/approveMany {ids}` processes ids in the given order with the rules above, and succeeds if any one succeeds.
- `proposal/reject {id, reason}` sets status `rejected` and sets `agents[a].cooldowns[key] = t + (reason==='wrong' ? 168 : 24)`, where `key = kind|target.kind|target.id|target.channel`.
- `proposal/undo {id}` requires `MC.runtime.undoCheck(...).ok`. It applies `proposal.inverse` with origin `'agent:'+agentId`, then sets status `undone`. Undo of a stale, rejected or pending proposal fails.

**Agent actions:**

- `agent/runNow` on a paused or Off agent runs it once at the next tick with autonomy treated as `suggest`. An agent runs at most once per tick.
- `agent/setCadence {id, cadence}` accepts values from `[1,2,3,6,12,24,48,72,168]` within the def's `cadence.min..max`. Phase is unchanged.
- `agent/setParams {id, params}` validates every key against the def. `resetParams` restores the defaults.
- `agent/setStatus {id, status:'active'|'paused'}`. `agent/setAutonomy {id, autonomy}` must be in `def.autonomy.allowed`.

**`guardrails/update {patch}` ranges:**

| Field | Range |
|---|---|
| `freqCap.*` | 1–14 |
| `quiet.start`, `quiet.end` | 0–23 |
| `maxShiftPct` | 5–50 |
| `minSample` | 100–5000 |
| `maxDailySpend` | 500–10000 |
| `holdoutPct` | 0–20 (affects only campaigns created afterwards) |
| `brand.banned` | ≤ 30 strings of ≤ 30 chars each |
| `brand.maxSubject` | 30–90 |
| `brand.maxGrade` | 4–12 |

Keys `protectDrafts`, `quiet.channels`, `brand.smsOptOut` and `consent` are rejected.

**Feed for user actions.** `dispatchUser` appends `{kind:'user', text: def.describe(world, payload), entity}` for every successful action except `proposal/*` (those add `approved`/`rejected`/`undone` items) and `insight/dismiss` (no item).

Inverses of `campaign/remove` and `segment/remove` recreate the entity with its original id through the inverse-only payload field `restoreId`. A user dispatch carrying `restoreId` is rejected.

### 10.6 Tick pipeline — `MC.engine.advance(world)` (replaces §5.1 ordering)

1. `t = ++world.meta.tick`, `h = hourOf(t)`, `d = dayOf(t)`.
2. **Day roll** (`h === 0`), via `MC.sim.dayRoll(world, d)`, in this order:
   1. Push `metrics.days` entry for d.
   2. `F *= 0.8`.
   3. Clear the `sent7` slot `d mod 7`.
   4. `metrics.hours` ×0.9.
   5. Update `visits30` (§10.7).
   6. `MC.models.scoreProfiles` (on Mondays, first the propensity refit, §10.8).
   7. Recount every segment in `segments.order` (`count`, `countDay`, push to `countHist`), then `bump('segCounts')`.
   8. Dynamic entry for live campaigns (members of `segmentId` ∪ `include` minus `suppress` with `step === -1`).
   9. Rebuild each live campaign's `enroll.order` (prop desc, ties by index).
   10. Rebuild the organic hazard table and the `_ads` tables.
3. **Status** (`MC.sim.step` part 1), campaigns in `campaigns.order`:
   - scheduled with `startTick ≤ t` → live;
   - live/paused with `endTick ≤ t` → completed, with feed item "{name} completed at {pct} of goal".
   - Pending proposals targeting a campaign that is now completed, or was removed, become `expired`.
4. **Owned sends**, live campaigns in order (§10.7).
5. **Paid channels**, live campaigns in order, channels in `MC.CH.PAID` order (§10.7).
6. **Organic orders** (§10.7).
7. Aggregates are written as events happen, then `bump(world,'metrics','profiles','enroll')`.
8. **Runtime:**
   1. Expire pending proposals with `expiresTick ≤ t`.
   2. Realize applied/auto proposals with `appliedTick + horizon === t` (§10.8).
   3. For each def in ascending `def.order`: if `agent.status==='active'` and autonomy ≠ `off` and `t ≥ phase` and `(t − phase) % cadence === 0`, or if `runRequested`, call `MC.runtime.runAgent(world, id, t, reason)`. Each run observes the world **including** earlier agents' auto-applied changes in the same tick.
9. Return. `tickOnce` then computes `MC.engine.checkpoints[t] = digestWorld(world).state` when `h === 0`, and notifies once.

`def.order`: optimizer 1, sendtime 2, pacer 3, guard 4, analyst 5, copy 6, scout 7, planner 8.

### 10.7 Simulation constants and formulas (amends §5.2–§5.3)

All constants live in `MC.sim.CONST`. Values marked ≈ are starting points that L4 may tune to meet the §5.3 calibration targets; nothing outside L4 hardcodes them.

**Owned sends (journey engine).**

- Iterate `enroll[cid].order`. Skip profiles with `step < 0` or `due > t`.
- Advance through steps instantly, at most 16 transitions per profile per tick:
  - `entry`: move to `next`.
  - `wait`: move to `next`, set `due = t + waitH`, stop.
  - `send`: on success, increment `steps[stepId][0]`, move to `next` and continue.
  - `exit`: set `step = -2` and `exited++`.
- Decide rules:
  - `opened`, `clicked`, `purchased`: test `flags` bits 1, 2 and 4 for this campaign.
  - `consent`: `value` is a channel.
  - `propensityAbove`: `prop > value`.
  - `bestChannel`: follow `branches[bestCh name]`, or `no` when 255.
  - Each decision increments `steps[stepId][1 or 2]`.
- At a `send` step the cohort is `ctl[i]` (1 = control). The policy is `campaign.*` for treatment and `campaign.ctl.*` for control.
- The step is **skipped** (advance to `next`, no send) if:
  - the channel is not in `campaign.channels`;
  - the policy's `channelPaused[ch]` is set;
  - the cohort has no eligible variant (treatment: `status==='live'`; control: `ctlStatus==='live'`, with a share in the policy alloc); or
  - consent is missing or the profile has unsubscribed.
- The send **waits** (`due` = next tick, re-checked hourly) if:
  - the profile is suppressed (`supUntil > t`; treatment only — control ignores suppression);
  - `Σ sent7` for the channel ≥ `freqCap[ch]`;
  - `inQuiet(h)` for sms/push;
  - the hour is outside the send window; or
  - today's channel quota is used up.
- Send window: a fixed `sendHour` s allows hours s, s+1, s+2 (mod 24). `'adaptive'` allows only `bestHr[i]`. For sms/push an adaptive hour inside quiet hours is clamped to `quiet.end` (if it is in the morning half) or `quiet.start − 1`. Control uses `ctl.sendHour` (seeded and user-created campaigns default to 10 for email/sms/push).
- Quota: `floor(dailyBudget(world,cid,ch,d) / unitCost[ch])` sends per day, counted from `metrics.days[di].c[cid].ch[ch][SENT]`.
- Variant pick: `rng.weighted` over the policy alloc restricted to eligible variants.
- Caps: 600 sends per campaign per tick and 1,500 per tick globally. Profiles left over keep `due = t + 1`.
- rng streams:
  - sends: `fork(seed,'sim',cid,t)`
  - paid: `fork(seed,'paid',cid,ch,t)`
  - organic: `fork(seed,'organic',t)`
  - day-roll draws: `fork(seed,'day',d)`
  - enrollment: `fork(seed,'enroll',cid,t)`
- `dailyBudget(world,cid,ch,d) = max(0, byChannel[ch] − spentBefore(d)[ch]) / max(1, daysLeft)`, where `daysLeft = dayOf(endTick − 1) − d + 1`, and spentBefore sums `cost` on days before d. It is 0 when the campaign is not live or the channel is paused (treatment policy).

**Per-send outcome:** the §5.2 formulas, plus:

| Term | Definition |
|---|---|
| `offerLift` | none 0, freeship .15, pct15 .30, pct25 .45, gift .10 |
| `discount` | pct15 .15, pct25 .25, otherwise 0 |
| `spam_v` | `0.6·features.caps + 0.3·features.urgency` (each 0/1) |
| conv probability | `min(0.95, σ(…)·season(d))` |
| product | `variant.productId ‖ campaign.productFocus ‖ first product of the profile's top category` |
| weekend | dow ∈ {0, 6} |
| `dcirc(a,b)` | `min(|a−b|, 24−|a−b|)` |
| unsubscribe | sets the channel's `unsub` bit and records `UNSUB` |
| conversion | updates `lastOrder`, `orders`, `spend`, `aov`, `flags \|= 4`, `enroll.rev[i]`; counts `REACT` when the previous `lastOrder ≤ d − 120` (or NEVER) |
| touches | every delivered send pushes a touch `(campaigns.all index, ch, t)` |

- **Latent quality** (`MC.sim.latentFor`): rng = `fork(seed,'variant',vid)`; draw `εo, εc, εv ~ N(0, 0.25)` in that order. With `s = copy.score(variant)` and `B = copy.BANK_STATS`:
  - `qo = 0.8·(s.logitO − B.meanO) + εo`
  - `qc = 0.8·(s.logitC − B.meanC) + εc`
  - `qv = εv`
  - `variant/update` recomputes `qo` and `qc` with the same ε (same fork).
- **Paid channels:** for each live campaign and paid channel not paused, with `S = dailyBudget`:
  - `spend_t = S·HOUR_SHAPE[h]`.
  - `HOUR_SHAPE` = [1,1,1,1,1,2,3,4,5,5,5,6,6,5,5,5,6,7,8,8,7,5,3,2] / 102.
  - Latent curve: `R(S) = A·(1 − e^{−S/B})`, with `B = U(0.6, 1.6)·plannedDaily` and `A = roas·plannedDaily / (1 − e^{−plannedDaily/B})`. roas ≈ U(2.2, 3.8) for social and U(1.6, 3.2) for web, drawn at create from `fork(seed,'curve',cid,ch)`. `plannedDaily = byChannel/daysTotal`.
  - Conversions ~ Poisson(`R(S)·creativeQ·season(d)·HOUR_SHAPE[h] / AOV_c`), where `creativeQ = exp(mean qc of the channel's live variants)` (1 if none) and `AOV_c` = mean product price for the campaign.
  - Impressions = `spend/CPM·1000` (CPM: social 9, web 6). Clicks ~ Binomial(impressions, social .008 / web .004).
  - Each conversion goes to a profile drawn from `_ads` (enrolled treatment members with the ads bit, weighted by `prop`) and gets revenue `price·lognormal(0, .35)·(1 − discount)`. A conversion writes a touch, attribution and profile updates.
- **Organic orders** (non-campaign baseline):
  - Daily hazard `η_i = σ(−5.9 + 0.9·p0_i + 0.6·maxAff_i − 0.004·recency_i)` ≈. The day-roll table is a cumulative Float64Array of η.
  - Per tick: orders ~ Poisson(`Ση·season(d)·HOUR_SHAPE[h]`). Each order picks a profile by binary search on the table and books revenue `price(top product)·lognormal(0, .35)` into `org` and `tot`, with profile updates.
  - Attribution runs over the touch ring as for every conversion.
  - At day roll, `visits30_i = min(255, round(visits30_i·29/30 + poisson(0.05 + 0.15·σ(eng_i))))`.
- **Attribution:**
  - Last touch: the latest ring touch with `t − touchT ≤ 168` gets 100% of revenue, added to `attrLast[ch]` of that campaign's day entry.
  - Linear: equal shares over the ring touches within 168 ticks.
  - Revenue with no touch counts only in `tot`/`org`.
  - Direct campaign conversions are credited in `c[cid].tot` and `ch` regardless of the attribution model.
- **Go-live enrollment** (`MC.sim.enroll`):
  - Members of `segmentId` ∪ `include` minus `suppress`, evaluated now.
  - `step` = index of the entry step, `due = t`.
  - `ctl[i] = (fnv1a(profiles.id[i] + '|' + cid) % 100) < holdoutPct`.
  - `entered += count`; `order` is built immediately.
- **Journey templates** (`MC.data.journeyTemplate(goal, channels)`; ids s1…; a step whose channel is absent uses the fallback shown or is spliced out):
  - **revenue / launch / conversions:** s1 entry → s2 send email → s3 wait 48 → s4 decide opened (yes s5 / no s6) → s5 send push [splice] → s7; s6 send sms [fallback email] → s7 wait 72 → s8 decide purchased (yes s10 / no s9) → s9 send email "Last call" → s10 exit.
  - **reactivation:** entry → send email → wait 72 → decide opened (yes: wait 24 → send email "Offer reminder"; no: send sms [fallback push, else splice]) → wait 96 → decide purchased (yes exit / no send email "Last chance") → exit.
  - **engagement:** entry → send email → wait 72 → decide clicked (yes exit / no send push [splice]) → exit.
  - Campaigns without email substitute their first owned channel for email. Campaigns with only paid channels get [entry → exit].

The `campaign/create` and `campaign/applyPlan` reducers draw `latent.curves['cid|ch']` for each paid channel through `MC.sim.curvesFor(world, campaign)` (also in REQUIRED).

### 10.8 Models, KPIs and impact measurement (amends §5.4)

**Features.**

- `engRate_i = (Σ_ch open + Σ_ch click) / (Σ_ch sent + 5)` over the `eng` counters.
- `recency_i = min(365, d − lastOrder)`, which is 365 for NEVER.
- `tenure` in days.
- Propensity `x = [1, recency/90, ln(1+orders), ln(1+spend)/6, engRate, visits30/10, max aff, tenure/365]`.

**Propensity fit.**

- Batch gradient descent on log-loss with L2 1e-3, lr 0.5.
- At boot: 60 iterations from zeros. Snapshot features are as of day −8 (data.generate keeps each profile's order days while generating). The label is "ordered in days −7..−1".
- Weekly refit at the Monday day roll: 15 iterations warm-started from `modelState.coef`, on the label "ordered after `snapDay`" with features `modelState.snap`. Then `snap` = current features and `snapDay = d`.
- The model predicts a 7-day probability `p7`. The stored score is `prop = 1 − (1 − p7)^(30/7)`.

**Other scores.**

- Best hour fallback (fewer than 3 opens) is the global mode of all smoothed histograms at that rescore.
- `bestCh` = 255 when no owned channel is consented.
- LTV per the §5.4 fix.
- `MC.models.explain` returns `w_k·x_k` contributions for prop (logit scale, labelled), the §5.4 terms for churn, and orders/aov/churn factors for LTV.

**Content score.**

- `len` = length of `fields[MC.copy.HOOK[channel]]`.
- `caps` = 1 if any word of 4 or more letters is all caps.
- `num` = the hook contains a digit.
- `personal` = contains `{first_name}`.
- `urgency` = matches /today|tonight|ends|last|hurry|now/i.
- `toneFit` = 1 if the bank tone matches `variant.tone`.
- `cta` ∈ {0, .5, 1} by the CTA verb list.
- `offer` = offerLift / .45.
- `image` = 1 if `imageId` is set.
- `grade` = Flesch–Kincaid on the body (email) or the main text: syllables = vowel groups per word (−1 for a trailing silent e, minimum 1); `grade = 0.39·words/sentences + 11.8·syllables/words − 15.59`, clamped 0–18.
- `zO = (logitO − meanO)/sdO`, `zC = (logitC − meanC)/sdC`.
- `predOpen = σ(logitO)`, `predClick = σ(logitC)` (clicks per open).

**KPIs** (`select.kpis`) cover the calendar month of the current day (`MC.time.monthOf`); `monthGoal` applies to every month.

| KPI | Value | Status pill |
|---|---|---|
| Revenue | Σ `tot.revenue` | Uses the goal probability P below: on (≥ 0.7), at risk (0.4–0.7), off (< 0.4) |
| Conversions | Σ `tot.conv` | Same as Revenue |
| Return on spend | Σ campaign `tot.revenue` / Σ campaign `tot.cost` | on if ≥ target, at risk if ≥ 0.85×target, else off |
| Unsubscribe rate | Σ UNSUB / Σ DELIV (owned) | on if ≤ target, at risk if ≤ 1.3×target, else off |

- **Projection:** `actualToDate` = complete days of the month before today. Holt runs on all complete days of `tot` (from day −60), and forecast points cover today through month end. `projected = actualToDate + Σ mean` with `Var = Σ Var_h`, and `P = MC.models.goalProbability(...)`. Today's partial actual is displayed but not added.
- **delta7** = last 7 complete days vs the prior 7. **spark14** = the last 14 complete days.

**Campaign goal metric** (`select.campaignGoal`): revenue → REV, conversions → CONV, reactivation → REACT, engagement → CLICK, launch → CONV, summed over `c[cid].tot` for the campaign's days.

- `outlookPct = (value + forecast to endTick) / target`. The forecast is Holt with ≥ 7 campaign days, otherwise mean daily × days left.
- `p` = goalProbability.

**Realized impact** (`runtime`, step 8 of §10.6). Let `dA = dayOf(appliedTick)` and `hd = max(1, round(horizon/24))`. Pre-period days are `[dA−hd, dA−1]` within the campaign's days; post-period days are `[dA, dA+hd−1]`. All results are in `$`.

| Kind | Method |
|---|---|
| traffic-shift, pause-variant, send-time, adaptive-send, new-variant, fatigue-suppress | `did`. Target channel (all owned channels if none), cohorts from `trt`/`ctl`. `r` = REV/SENT, except engagement/launch goals use CLICK/SENT × value per click (campaign REV/CLICK, fallback $2). `delta = ((rT_post − rT_pre) − (rC_post − rC_pre))·SENT_T,post`. Each cell's variance is `AOV²·c(1−c)/n` (c = CONV/SENT, AOV of the cell, fallback product price). `lo, hi = delta ∓ 1.28·SENT_T,post·sqrt(Σ var)`. With no pre sends, use `diff`: `(rT_post − rC_post)·SENT_T,post`. |
| budget-shift | `model`. Refit `fitResponse` per channel on the 21 days ending at realization; `delta = Σ_ch [R(newDaily) − R(oldDaily)]·hd ± 1.28·sd·sqrt(hd)`. |
| extend-campaign | `window`. Campaign revenue in [old endTick, new endTick). `proposal.horizon = newEnd − appliedTick`. |
| new-segment, retarget, campaign-draft, pause-channel | Not measured: `realized` stays null and Agent impact shows "Not measured". |

`agent.stats.expected` and `agent.stats.realized` sum only `$`-unit impacts.

### 10.9 Agents (amends §6)

**Extra def fields:**

- `autopilotMaxRisk`: optimizer `'medium'`, all others `'low'`.
- `cadence.min/max`: optimizer 1–24, sendtime 6–72, pacer 6–72, guard 3–48, analyst 1–24, copy 12–168, scout 24–168, planner 24–168.
- `horizon`: optimizer 72, sendtime 96, pacer 120, guard 72, analyst per proposal, copy 96, scout 0, planner 0.
- `materiality.min` (|impact.delta| in its unit): optimizer 25, sendtime 15, pacer 25, guard 2, others 0.
- Planner `autonomy.allowed = ['off','suggest']`.
- `preview?(input, ctx) -> { proposals, trace, plan }` (planner only).

**`decide` returns** `{ proposals:[Draft], insights:[InsightDraft], trace:[{step, text, rows?}] }`.

- `Draft = { kind, target:{kind,id,channel?}, title, rationale, evidence, impact, risk?, actions, diff, mustQueue?, horizon? }`.
- `InsightDraft = { kind, title, body, entity?, severity:'info'|'warn'|'crit', key }`.
- Trace rows are capped at 40 per run.

**`MC.runtime.runAgent(world, id, t, reason)`, exactly:**

1. Create `rng = fork(seed,'agent:'+id, t)` and `view = observeView(world)`, a shallow copy with `latent` removed that is never mutated.
2. `obs = def.observe(view, ctx)`; `inDigest = digest(obs)`.
3. `out = def.decide(obs, {rng, tick:t, params:agent.params, world:view, models:MC.models, copy:MC.copy, segments:MC.segments, util:MC.util})`.
4. For each draft in order:
   1. Drop it if under materiality.
   2. Drop it if `cooldowns[key] > t`.
   3. If a pending proposal has the same key: when `digest(actions)` is equal, drop the draft ("unchanged"); otherwise the old proposal becomes `superseded`.
   4. The surviving draft k (0-based among survivors) becomes a Proposal with `id`, `agentId`, `tick:t`, `status:'pending'`, `risk = draft.risk ‖ def.risk(draft, view)`, `guardrails = MC.guardrails.evaluate(world, draft, def)`, `baseVer` (ver of every existing entity the actions target), `expiresTick: t+48`, and `horizon`.
   5. Guardrails evaluated = `def.guardrails` ∪ {consent, protectDrafts, targetFresh, holdout}.
5. Route by `mode = (reason==='runNow' && autonomy==='off') ? 'suggest' : autonomy`.
   - **Autopilot** applies (`MC.runtime.apply(world, pid, 'agent:'+id)`, status `auto`) only if `!mustQueue`, every blocking guardrail passes, and `rank(risk) ≤ rank(autopilotMaxRisk)` with low 0 < medium 1 < high 2.
   - Otherwise the proposal stays pending with reason "Needs you: {first failed guardrail label | 'Always reviewed' (mustQueue) | 'High risk' | 'Medium risk'}". Suggest mode uses the reason "Suggested".
6. Insights: skip any whose `key` already exists on the same day; ids `${id}-${t}-i${k}`; feed kind `anomaly` or `insight`. Caps: insights 100, feed 400 (drop oldest).
7. `outDigest = digest({proposals: created, insights: createdInsights})`, `chain = hex8(fnv1a(prev + '|' + inDigest + '|' + outDigest))` with initial `prev = '00000000'`, `audit.head = chain`.
8. Update `lastRunTick = t`, `runRequested = false`, `stats.runs++`, `stats.proposed += created`.
9. Add one feed item only when something was created (`agent-applied` if any auto, else `agent-proposed`).

**`MC.runtime.apply(world, pid, origin)`:** resolve tmpIds, then for each action:

1. `inv = catalog.inverse(world, action)` (before applying).
2. `catalog.apply(world, action, {origin, tick})`.
3. Prepend `inv`, with created ids substituted, to `proposal.inverse`.

Then set `appliedTick = t`, `postVer` = current ver of every touched entity, and update stats (`applied` or `auto`, `expected`). If any action fails, the already-applied ones are reverted with the collected inverses and the proposal becomes `stale`.

**`undoCheck`:** ok only if status ∈ {applied, auto} and every `postVer` entry still matches. Otherwise the reason is "Can't undo: {Agent name | You} changed this {campaign|variant|segment} again at {HH:00}. Open the campaign to adjust.", built from the entity's `updatedBy` and `updatedTick`.

**`statusOf(world, id)`:**

- `state` is `'off'` if autonomy is off, `'paused'` if status is paused, `'queued'` if `runRequested`, else `'running'`.
- `nextRun` = the next t > now with `(t − phase) % cadence === 0`, or null when off or paused.

**`MC.engine.restart(seed = MC.SEED)`:** pauses, regenerates the world (clearing the log, checkpoints and toasts), resets `uiStore.focus` ids that no longer exist, and resumes at 1×.

**Per-agent fixes:**

- **Optimizer:** emits `campaign/setAlloc`, `variant/setStatus`. The prior uses `p̂ = predicted.open·predicted.click` (clicks per send) for engagement/launch goals, and `p̂ = predicted.open·predicted.click·0.06` (conversions per send) otherwise, with k = `priorStrength`. For sms, `predicted.open` is fixed at 0.92.
- **Send-Time Tuner** (emits `campaign/setSendHour`; payload key `hour`):
  - `w_h` = circularly smoothed share of the audience's `bestHr` at h.
  - `prior_h = r̄·clamp(0.6 + 9.6·w_h, 0.6, 1.6)`, where r̄ is the campaign × channel open rate.
- **Pacer** (emits `campaign/setBudget`):
  - Moves are expressed on totals: `Δtotal = Δdaily·daysLeft`.
  - The `pacing` insight has key `pacing|cid|ch`.
- **Guard:** emits `profiles/suppress` (one action per channel) and `campaign/setChannelPaused`.
  - Impact: `{metric:'unsubs avoided', unit:'#', delta}` with `tradeoff {metric:'revenue', unit:'$', delta:−forgone}`.
  - `maxSuppress` counts profiles with `supUntil > t` in the campaign's treatment audience, including the proposed ones.
- **Analyst:**
  - Emits `campaign/setEnd` (`extend-campaign`: mustQueue, risk medium; guardrails protectDrafts, targetFresh, budgetCap).
  - The weekly ROI insight runs on the first Analyst run with `dow === 1`.
  - Anomaly key is `anomaly|cid|metric|day`; goal-risk key is `goal|cid|day`.
- **Copy Drafter:** emits `variant/create`.
- **Scout:**
  - Emits `segment/create`, `campaign/include`.
  - At most 400 candidate conditions (ATTRS × deciles). Depth 2 expands only the top 8 depth-1 rules.
  - Label: profiles with a ring touch in the lookback; converted = `lastOrder ≥ d − lookbackDays`.
- **Planner:**
  - Emits `campaign/create`.
  - An event e is **covered** when some campaign with status ≠ completed has `eventDay === e.day` or `dayOf(startTick) ≤ e.day < dayOf(endTick)`, or a pending planner proposal targets `{kind:'event', id:'event-'+e.day}`.
  - The draft runs from `tickOf(e.day−1, 9)` to `tickOf(e.day+2, 0)` with `eventDay = e.day`.

**Planner preview I/O.**

- `input = { brief, regen:{[section]:n}, draftId? }`.
- `Brief = { name, goal:{type, target}, productFocus|null, segmentId|null, budget, startDay, endDay, channels:[], tone, offer, notes }`.
- Returns `plan = { briefDigest, sections:{ audience:{options:[{segmentId|null, segment?, name, reach, meanProp, ev, why}], chosen}, budget:{byChannel, why:[{ch, roas, marginal}]}, journey:{steps}, content:{variants:VariantDraft[], alloc:{[ch]:{[tmpId]:share}}}, forecast:{mean, lo, hi, daily:[{day, mean, lo, hi}]}, preflight:{items} }, payload }`.
- `payload` is ready to dispatch as `campaign/create` (or `campaign/applyPlan` when `draftId` is set).
- Planner tables live at `MC.planner = { GOAL_WEIGHT, PRIOR_ROAS, plan(world, brief, regen) }`.

### 10.10 Seeded world: taxonomy, segment rules, six campaigns

All data is synthetic and labelled sample data. Names come from generic first-name lists plus a last initial (for example "Maya R."). Profile ids are `P-00000`…`P-05999`.

**Taxonomy (`MC.data`).**

- `CATEGORIES` = hike (Hiking), camp (Camping), climb (Climbing), run (Trail running), apparel (Apparel), in this order. This is the `aff` and `cat` index.
- `TIERS` = base, trailhead, summit, peak (labels Base, Trailhead, Summit, Peak), with codes 0–3.
- `REGIONS` (states in this order; `STATES` is the flattened list of 25 and `profiles.state` indexes it):

| Region id | Label | States |
|---|---|---|
| pnw | Pacific Northwest | WA, OR, ID |
| west | West | CA, NV, AZ, UT |
| mountain | Mountain | CO, MT, WY, NM |
| midwest | Midwest | IL, MN, MI, WI, OH |
| south | South | TX, GA, NC, TN, FL |
| northeast | Northeast | NY, MA, VT, PA, ME |

- `PRODUCTS` has 24 entries, at least 4 per category, ids prefixed `p-`. These ids, categories and prices are fixed: `p-trail-boot` (hike, $159), `p-camp-stove` (camp, $89), `p-trail-shoe` (run, $139), `p-insulated-jacket` (apparel, $189). Each category's first product is its "top product".

**Rule format** (shared by segments.js, the Builder, Scout, data.js and the planner):

```js
Rule = { op:'all'|'any', items:[ Cond | Rule ] }   // nesting ≤ 3 levels (root = 1); an empty group matches everyone
Cond = { attr, cmp, value }  // num: 'gt'|'gte'|'lt'|'lte'|'between'(value [lo,hi]) · cat: 'in'|'notIn'(value string[]) · bool: 'is'(true|false)
```

Cat values are the string ids above (state codes, region ids, tier ids, category ids, channel names). `compile` maps them to column codes.

**`MC.segments.ATTRS` keys** (group / type):

- **Profile:** `state` cat, `region` cat, `age` num, `tier` cat, `tenureDays` num, `canEmail`, `canSms`, `canPush`, `canAds` bool (consent bit set and unsub bit clear).
- **Behavior:** `lastOrderDays` num, `orders` num, `spend` num $, `aov` num $, `visits30` num, `topCategory` cat, `affHike`, `affCamp`, `affClimb`, `affRun`, `affApparel` num 0–1, `engRate` num 0–1, `fatigue` num, `sent7` num (all owned channels).
- **Predictions** (badge "Predicted"): `prop` num 0–1, `churn` num 0–1, `ltv` num $, `bestCh` cat (email, sms, push, none), `bestHr` num 0–23.

**Seeded segments** (author `user`, `createdTick` −24·30, ver 1):

| id | Name | Rule |
|---|---|---|
| s-layer | Cold-weather shoppers | all[affApparel ≥ .3, region in [pnw, mountain, midwest, northeast]] |
| s-lapsed | Lapsed hikers 120d+ | all[lastOrderDays > 120, affHike ≥ .3] |
| s-campers | Car campers | all[affCamp ≥ .35] |
| s-loyal | Summit & Peak members | all[tier in [summit, peak]] |
| s-runners | Trail runners | all[affRun ≥ .35] |
| s-gift | Gift givers | any[orders ≥ 4, aov ≥ 120] |
| s-pnw | Pacific Northwest | all[region in [pnw]] |
| s-highltv | High predicted LTV | all[ltv ≥ 480] |
| s-new | New customers (90 days) | all[tenureDays < 90] |

**The six seeded campaigns** (`campaigns.order` in this order; `holdoutPct` 10; `createdBy` user):

| id · name | Status at tick 0 | Goal | startTick → endTick | Segment | Channels | Tone · offer · product | Budget by channel ($) | sendHour |
|---|---|---|---|---|---|---|---|---|
| `c-wll` Winter Layering Launch | live (enrolled by data.generate at t=0) | revenue 38,000 | 0 → tickOf(21,0) | s-layer | email, push, social | adventurous · none · p-insulated-jacket | email 900, push 300, social 7,800 (=9,000) | email 9, push 18 |
| `c-lhw` Lapsed Hiker Win-back | live (enrolled at t=0) | reactivation 90 | 0 → tickOf(26,0) | s-lapsed | email, sms, social | warm · pct15 · p-trail-boot | email 400, sms 900, social 4,700 (=6,000) | email 10, sms 12 |
| `c-cks` Camp Kitchen Bundle | scheduled (goes live at tick 10) | conversions 220 | 10 → tickOf(14,0) | s-campers | email, push, social | practical · freeship · p-camp-stove | email 300, push 100, social 3,800 (=4,200) | email 10, push 17 |
| `c-bfe` Black Friday Early Access | scheduled | revenue 45,000 | tickOf(17,0) → tickOf(21,0) (4 days → $2,400/day ≤ maxDailySpend) | s-loyal | email, sms, push, social, web | urgent · pct25 · null (catalog) | email 400, sms 800, push 100, social 4,800, web 3,500 (=9,600) | email 8, sms 11, push 19 |
| `c-hgg` Holiday Gift Guide | draft (brief filled; "Continue planning") | revenue 30,000 | tickOf(25,9) → tickOf(46,0) | s-gift | email, push, web | warm · gift · null | email 600, push 200, web 7,200 (=8,000) | email 10, push 18 |
| `c-trs` Fall Trail Running Sale | completed (history only) | conversions 150 | tickOf(−40,0) → tickOf(−19,0) | s-runners | email, social | practical · pct15 · p-trail-shoe | email 500, social 3,500 (=4,000) | email 10 |

- `eventDay`: c-bfe 20, all others null.
- Journeys come from `MC.data.journeyTemplate(goal.type, channels)`.
- `ctl` equals the user policy at seed time.
- `brief` holds a 1–2 sentence plain-language brief for each.

**Seeded variants:**

- `MC.copy.generate({channel, tone, productId, offer, count, seedKey:'seed:'+cid+':'+ch}, seed)`.
- Owned channels get 3 variants (A, B, C), with alloc .5/.3/.2. Social and web get 2 (A, B), with alloc .5/.5.
- Ids are `v-<cid without "c-">-<ch>-<letter>`, for example `v-wll-email-a`.
- Status `live` for live and scheduled campaigns, `draft` for c-hgg, `retired` for c-trs. `ctlStatus` mirrors status.

**History** (days −60..−1, aggregate draws):

- Organic `tot`/`org` daily Facts.
- c-trs per-channel, per-variant and per-cohort Facts reaching ≈ 92% of its goal, with B beating A. History attribution credits the sending channel.
- Per-profile counters (`eng`, `openHr`, `orders`, `spend`, `aov`, `lastOrder`, `visits30`, `tenure`) drawn from the latent profile so that the §5.3 rates hold.

**Calibration.** L3/L4 may retune only the `goal.target` values and the ≈ constants to meet §5.3. Views and agents never hardcode targets.

**Agents at boot:** every agent `status:'active'`, autonomy and params at their defaults, `lastRunTick:null`, stats zero. No proposals, feed items or insights exist at tick 0.

### 10.11 Determinism: canonical form, digests, replay and verify

**Banned in all logic** (everything except `MC.util.now`, engine.js scheduling, and UI-only code that never writes the world): `Math.random`, `Date.now`, `new Date()` with no arguments, `performance.now`, `crypto.getRandomValues`, `Intl`, `toLocaleString`, iteration over `Set`/`Map` insertion order of unsorted data, `Object.keys` order on numeric-like keys, and comparator sorts without a total tie-break.

Views that need randomness (for example the leaderboard's P(best)) use `MC.rng.fork(seed,'ui',…,tick)`, so values do not flicker between renders.

**`MC.util.canon(v)`** — exact:

| Value | Output |
|---|---|
| `null` | `null` |
| boolean | `true` / `false` |
| string | `JSON.stringify(s)` |
| integer (including −0) | `String(x)`; −0 → `0` |
| NaN | `"NaN"` |
| ±Infinity | `"Inf"` / `"-Inf"` |
| other numbers | `x.toPrecision(12)` with mantissa trailing zeros and any trailing `.` removed (`0.100000000000` → `0.1`, `1.50000000000e-7` → `1.5e-7`) |
| array | `[` + items joined by `,` + `]`; `undefined` → `null` |
| typed array | `"#" + hex8(fnvBytes(arr)) + ":" + arr.length`, as a JSON string |
| plain object | `{` + entries sorted by key (code-unit order), skipping `undefined` values, functions and keys starting with `_`, each as `JSON.stringify(k):canon(v)`, joined by `,` + `}` |

- `fnv1a` is 32-bit over UTF-16 code units: `h ^= c; h = Math.imul(h, 0x01000193) >>> 0`.
- `fnvBytes` runs over `new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)`.
- `digest(v) = hex8(fnv1a(canon(v)))`.

**`MC.replay.digestWorld(w)`:**

```
parts = { profiles: digest(w.profiles), latent: digest(w.latent), metrics: digest(w.metrics), enroll: digest(w.enroll),
          entities: digest({meta, seq, catalog, modelState, segments, campaigns, variants, agents, proposals, feed, insights, guardrails}),
          log: digest(w.log) }
state = hex8(fnv1a(['profiles','latent','metrics','enroll','entities','log'].map(k => parts[k]).join('|')))
audit = w.audit.head
```

`rev`, every `_`-prefixed key and every `_ms` field are excluded. Audit entries are covered by `audit.head` (the chain).

**`MC.replay.run({seed, log, toTick, onProgress, chunk:20, checkpoints?})`:**

```
w = MC.data.generate(seed); i = 0; first = null
apply(stamp): while (i < log.length && log[i].tick === stamp) { r = MC.catalog.dispatchUser(w, {type, payload}); if (!r.ok) → diverged at stamp; i++ }
for t = 1..toTick:
  apply(t-1); MC.engine.advance(w)
  if (hourOf(t) === 0 && checkpoints && checkpoints[t] !== undefined && first === null
      && digestWorld(w).state !== checkpoints[t]) first = t
  every `chunk` ticks: onProgress(t, toTick); await setTimeout(0)   // never requestAnimationFrame (stalls in hidden tabs)
apply(toTick)
resolve(w)    // plus the first mismatched checkpoint tick, if any
```

Live dispatches are stamped with `world.meta.tick` and are processed before tick T+1. Replay applies entries stamped t−1 just before advancing to t, so the two orderings are identical.

**`MC.replay.verify({onProgress})`:**

1. Remember the speed and `setSpeed('pause')`. Set `uiStore.verifying` (the UI shows "Simulation paused while verifying").
2. Snapshot `N = live.meta.tick`, `log = live.log.slice()`, `liveDig = digestWorld(live)`, and a copy of `MC.engine.checkpoints`.
3. `w = await run({seed: live.meta.seed, log, toTick: N, checkpoints})`.
4. `repDig = digestWorld(w)`; `match = liveDig.state === repDig.state && liveDig.audit === repDig.audit`.
5. On mismatch, `firstDivergence`:
   - Take the first mismatched checkpoint (or N), then the first audit entry, by id, in the ticks up to it whose `inDigest`/`outDigest` differ between live and replay → `{tick, agentId, auditId, live:outDigest, replay:outDigest}`.
   - Otherwise, the first differing part name among `digestWorld` parts.
6. Restore the speed, clear `verifying`, and resolve `{ match, tick:N, ms, live:liveDig, replay:repDig, firstDivergence? }`.

**`MC.dev.selfTest()` rows:**

- generate time;
- `segments.evaluate` time;
- mean and max `advance` time over 48 ticks on a generate copy;
- a determinism check (generate twice → equal digests; 48 advances twice → equal digests);
- a scan of `fn.toString()` for every function under `MC.util/time/rng/catalog/models/segments/copy/data/guardrails/sim/select/runtime` and every agent def for banned tokens (`MC.util.now` and `MC.engine.*` are exempt);
- `MC.contract.check()`;
- 14-day goal attainment with agents Off vs default autonomy, run on copies and never on the live world.

### 10.12 Performance budgets (replaces §5.5)

| Operation | Budget |
|---|---|
| `MC.data.generate` | < 300 ms for 6,000 profiles and 60 days of history (aggregate daily draws; no per-tick simulation of history) |
| `segments.evaluate` | < 3 ms typical, 10 ms max (compiled closures, one pass, no allocation per profile) |
| `advance`, normal tick | < 8 ms typical; ≤ 1,500 sends per tick; at most 16 step transitions per profile |
| `advance`, day-roll tick | < 40 ms (rescore, segment recounts, ordering, weekly refit) |
| One agent run | < 15 ms; Scout < 30 ms |
| `digestWorld` | < 15 ms (once per sim day for checkpoints) |
| Render per tick | Only subscribed components re-render; no view remounts; each chart ≤ 400 SVG nodes; DataTables page or virtualize above 200 rows (Profiles: 50 per page) |
| Scheduler | `setTimeout` chain. Next delay = `max(0, interval − elapsed)`, and exactly 1 tick per fire (overruns skip, never queue). Hidden tabs are naturally throttled. Paused = no timer. |

### 10.13 UI contracts: uiStore, selector shapes, live updates, theming, hosting, phone, a11y

**uiStore state** (L1 owns the store; app.js owns persistence):

```js
{ theme:'system'|'light'|'dark', route:'home'|'campaigns'|'content'|'audiences'|'analytics'|'agents',
  drawer:null|'approvals'|'menu', sampleDismissed:false, verifying:null|{done,total},
  focus:{ campaigns:{mode:'board'|'list'|'calendar'|'planner'|'detail', id:null, tab:'overview'},
          content:{variantId:null, channel:'email'}, audiences:{tab:'segments', segmentId:null, profileIdx:null},
          analytics:{range:30 /*14|30|60|'all'*/, campaignIds:[], channel:'all', metric:'revenue', showAgents:true},
          agents:{tab:'roster', agentId:'optimizer', auditId:null} },
  plannerBrief:null|Brief, toasts:[{id, text, tone, actions:[{label, kind:'undo'|'view'|'review', proposalId?, route?}]}],
  notify:{ [agentId]:'all'|'changes'|'silent' } }
```

- localStorage key `kestrel.ui.v1` holds `{theme, route, sampleDismissed, notify}`. Every read and write is wrapped in try/catch, and a failure falls back to the defaults.
- Routing:
  - Only `#home`, `#campaigns`, `#content`, `#audiences`, `#analytics` and `#agents` are valid. Unknown or empty hashes render home.
  - `MC.nav.go` sets focus, then `location.hash`. A `hashchange` listener updates `route`.
  - No `pushState`, no query strings, no ids in the hash.
- Theme: `document.documentElement` gets `data-theme="light"|"dark"`, or no attribute for system.

**Toasts:** app.js compares `meta.tick` after each notify and reads feed items with `tick === meta.tick`.

- If `notify[agentId]` is `silent`, skip. If it is `changes`, take only `agent-applied`; `all` also takes `agent-proposed`.
- Make at most one toast per tick (the §7.0 coalescing copy) and keep at most 3 visible.
- Toasts never take focus.

**Selector return shapes** (`f = {metric, campaignIds?, channel?:'all'|ch, fromDay?, toDay?, h?}`; days are sim days; empty inputs return empty arrays, never throw):

| Selector | Returns |
|---|---|
| `kpis(w)` | `{month:{label,fromDay,toDay}, revenue:{value, goal, projected:{mean,lo80,hi80}, p, status:'on'\|'risk'\|'off', delta7, spark14}, conversions:{…same}, roas:{value, target, delta7, spark14, status}, unsubRate:{value, target, delta7, spark14, status}}` |
| `campaignRows(w)` | `[{id, name, status, channels, startTick, endTick, spend, budget, goal:{type,target,value,outlookPct,p}, agentChanges24h, spark14}]` in `campaigns.order` |
| `campaignStats(w,cid)` | `{revenue, conv, clicks, sends, cost, roas, react, spentByCh, budgetByCh, dailyBudgetByCh, pace, daysLeft, goal}` |
| `campaignGoal(w,cid)` | `{type, target, value, outlookPct, p}` |
| `variantStats(w,cid,ch)` | `[{id, name, author, status, share, prevShare, sends, opens, clicks, conv, revenue, openRate, clickRate, convPerSend, ci:[lo,hi], pBest}]` |
| `series(w,f)` | `[{day, value, partial?}]` |
| `forecast(w,f)` | `{actual:[{day,value}], points:[{day,mean,lo80,hi80,lo95,hi95}], cumulative?:{actualToDate, projected}, goal?, p?}` (`f.month:true` gives the KPI projection) |
| `funnel(w,f)` | `[{key,label,value}]` |
| `channelCompare(w,f)` | `[{ch, sends, clicks, conv, revenue, cost, roas, ctr, ci}]` |
| `attribution(w,f)` | `{byChannel:{[ch]:$}, byCampaign:{[cid]:{[ch]:$}}}` (with `f.model`) |
| `liftVsControl(w,cid)` | `{metric, trt:{rate,n}, ctl:{rate,n}, lift, lo, hi}` or null when the control has fewer than 100 sends |
| `agentMarkers(w,f)` | `[{day, tick, agentId, proposalId, label}]` |
| `openProposals(w)` | pending Proposal[], newest first |
| `proposalsFor(w,id)` | every status, newest first |
| `feed(w,{kinds,entityId})` | FeedItem[] |
| `agentRoster(w)` | `[{id, name, short, status, autonomy, lastRun, nextRun, changes24h, pending}]` |
| `agentImpact(w)` | `{rows:[{proposalId, agentId, title, appliedTick, expected, realized, method, status:'measuring'\|'realized'\|'not-measured'\|'undone', hoursLeft}], totals:{expected, realized}}` |
| `segmentRows(w)` | `[{id, name, count, change7, meanProp, meanLtv, roas, usedIn:[cid], author}]` |
| `movers(w)` | top 3 by \|Δ revenue, last 7 days vs prior 7\|: `[{campaignId, name, delta, agentId?, proposalId?, note}]` |
| `insights(w,o)` | Insight[] |
| `journeyStats(w,cid)` | `{[stepId]:{inStep, sentToday, yesPct?, noPct?}}` |
| `profileRow(w,i)` | plain object with every ATTRS key plus `id`, `name`, `idx` |
| `previewProfiles(w)` | `[{idx, name}]` for profile indices 0–7 |
| `variantLibrary(w)` | `[{campaignId, name, variants:[{id, name, channel, status, share, author}]}]` |

**Live-update safety** (adds to §7.8):

- The root and the view components are never keyed by tick.
- Editors take their initial value from the store once and then live in `useDraft`. A `ver` change while dirty shows `ConflictChip` with `agentId` taken from the entity's `updatedBy`.
- Never call `focus()`, `scrollIntoView` or `scrollTo` in response to store changes.
- Inputs are controlled by local state only.
- Lists keyed by entity id. Feed-style lists use `useFrozen`, and frozen state persists across ticks.
- Tooltips and hover are anchored by day key or entity id.

**Theming tokens** (`css/tokens.css`). The full light palette sits on bare `:root` with `color-scheme: light`. Dark overrides only redefine tokens, under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` and `:root[data-theme="dark"] { … }`, both with `color-scheme: dark`. Nothing else may contain a color literal: view CSS, kit CSS and JS reference `var(--token)` only. SVG colors go through CSS classes or `style`, never `fill="var(…)"` attributes.

| Token | Light | Dark |
|---|---|---|
| `--ground` | #F4F2EE | #12171C |
| `--surface` | #FFFFFF | #1A2128 |
| `--surface-2` | #F8F7F4 | #212A32 |
| `--ink` | #1C2329 | #E8ECEF |
| `--ink-2` | #3E4A55 | #B7C0C8 |
| `--ink-3` | #65717C | #8C99A6 |
| `--line` | #E2DFD8 | #2C3640 |
| `--line-strong` | #C9C4BA | #3D4A56 |
| `--accent` | #2F5D86 | #8DB4DC |
| `--accent-soft` | #E3ECF4 | #1E2E3F |
| `--on-accent` | #FFFFFF | #0E1620 |
| `--agent` (russet) | #A4471F | #E08A5F |
| `--agent-soft` | #F6E6DD | #3A2419 |
| `--on-agent` | #FFFFFF | #1A0F09 |
| `--good` | #2E7D4F | #6CC48C |
| `--good-soft` | #E1F1E6 | #173326 |
| `--warn` | #8A5D0C | #D7AE5E |
| `--warn-soft` | #F6ECD6 | #3A2E14 |
| `--crit` | #B3261E | #F08A80 |
| `--crit-soft` | #F7E1DF | #3D1B18 |
| `--focus` | #2F5D86 | #8DB4DC |
| `--chart-1..6` | §8.1 light | §8.1 dark |
| `--chart-grid` | #E7E4DE | #26303A |
| `--chart-band` | rgba(47,93,134,.14) | rgba(141,180,220,.16) |
| `--shadow-pop` | 0 8px 24px rgba(28,35,41,.14) | 0 8px 24px rgba(0,0,0,.5) |

- Dark `--ink-3` is #8C99A6, which overrides §8.1's #7F8D9A so muted text keeps ≥ 4.5:1 on `--surface-2`.
- `body { background: var(--ground); color: var(--ink); font-family: var(--font-ui); }`.

**Hosted-artifact rules:**

- No `alert`, `confirm`, `prompt`, `window.open`, `window.print`, `<a download>`, `fetch`, XHR, WebSocket, `<iframe>`, `<form action>`, external images or external links.
- Scripts come only from the 3 URLs in §10.2. Stylesheets come only from Google Fonts plus local files.
- Navigation is bare-hash only. Storage is `localStorage` in try/catch, for conveniences only; simulation state is never persisted.
- The page must render if fonts fail (the font stacks have system fallbacks).
- Trademark rule: no inspiration-vendor names anywhere.

**Phone (~400px):**

- The gutter is `clamp(16px, 2.5vw, 32px)` and must be ≥ 16px.
- The sidebar is hidden below 640px.
- Every grid/flex child sets `min-width: 0`. Long strings use `overflow-wrap: anywhere`.
- Wide tables, the Gantt, the heatmap and flows live inside `.k-scroll-x` (`overflow-x: auto`), so the page itself never scrolls horizontally.
- Drawers become full sheets. Hit targets are ≥ 40px.
- Charts size from `useWidth` and never use a fixed pixel width wider than their container.

**Accessibility:**

- `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`. Every control has a visible or aria label.
- Ids are stable kebab-case `{view}-{thing}` (the ids listed in §7 bind).
- Segmented controls are radiogroups with arrow keys. The drawer traps focus and Esc closes it.
- `aria-live="polite"` appears only on the toast host and the replay progress text.
- `.num` (tabular-nums) applies to every number.
- `prefers-reduced-motion` removes transitions, pulse glow and tweening.

### 10.14 Goal coverage checklist (acceptance)

| User-goal element | Where it is satisfied |
|---|---|
| Plan campaigns | Campaigns → Planner (brief → 6 sections → `campaign/create` / `applyPlan`), Board/List/Calendar, detail tabs; Campaign Planner agent drafts event campaigns weekly |
| Compose content | Content Studio composer, previews, brand checks with deterministic Fix, `MC.copy.generate`, Add to campaign; Copy Drafter adds challengers |
| Segment audiences | Audiences → Describe (parse) → rule builder with live count, overlap, profiles with predictions; Segment Scout suggests segments |
| Predictive analytics | Propensity, churn, LTV, best channel and hour per profile; Holt forecasts with bands and goal probability; anomalies; response curves and what-if; attribution; control lift |
| Multiple autonomous deterministic agents running continuously in the background | 8 agents on phased cadences driven by the sim clock, which starts at 1× right after boot; per-agent autonomy Off/Suggest/Autopilot; AgentPulse, feed and toasts while the marketer works elsewhere |
| Continuously updating agents | Agents → Roster: autonomy, cadence, params, pause/resume, Run now; Guardrails tab; all logged user actions |
| Continuously optimize and improve | Optimizer, Send-Time, Pacer, Guard and Copy act on live campaigns; realized impact measured against the control cohort; agent track records |
| Approvals, undo, trust | Approvals drawer, ProposalCard (Why, Expected impact, Guardrails, Changes), stale handling, `undoCheck`, chained audit |
| Determinism verification | Agents → Audit & replay → Verify determinism (§10.11), with first-divergence reporting |

## 11. Design amendments (binding — added Nov 15; override §9, the §7 view specs and §10.11 where they conflict)

Direction from the user: a wow-factor prototype that does not overwhelm; the simulation must be invisible; no generic AI-generated design tells; the agentic layer surfaced meaningfully but calmly.

### 11.1 The simulation is invisible
- No sim clock, no "Sim day N", and no Pause/1x/4x/16x speed controls anywhere in the UI. The engine ticks continuously at its default pace; pacing constants live only in engine.js. (Engine/time remapping happens in a core pass; view builders follow the display rules below now.)
- Views show calendar dates and relative times ("2h ago", "yesterday"), never ticks. Agent cadence is worded ("every 6 hours"), never "every N ticks". Display dates anchor to the real current date at boot via MC.time's display mapping; tick arithmetic is unchanged.
- Sample-data banner copy: "You're exploring Fernway Outfitters, a fictional outdoor brand with sample data." Never mention simulator, determinism, ticks or seeds in marketer-facing copy.
- Agents view: NO "Verify determinism" control and NO digest/hash values anywhere (supersedes §10.11's UI; MC.replay remains a dev-only utility with no UI). Run traces read as plain language: what the agent saw, what it decided, why, what changed, with Undo where applicable.
- The overflow menu may hold a single quiet "Jump ahead a day / a week" item; nothing else in the chrome references time control.

### 11.2 No AI tells (hard rules, all views and kit)
- No colored left accent rails or edge bars on cards, rows, callouts or banners; status is carried by one small pill or dot, never an edge stripe.
- Max one bordered surface level per region; no card-in-card nesting. Prefer whitespace and type hierarchy over boxes; hairline dividers only where scanning needs them.
- At most one status pill per row; no chip or badge clusters. Semantic color only for real status; the russet agent color appears only on genuine agent attributions.
- No gradients, no glow shadows (one subtle elevation for overlays and drawers only), no emoji, icons only in nav and on actions, not beside every label.
- No walls of stat tiles: Command Center leads with at most 4 KPIs; other views lead with their object, not tiles.
- One primary button per region; everything else quiet or text style.

### 11.3 Calm agentic surfacing
- One "What changed" feed (home) narrates agent actions in plain English with inline View and Undo.
- Objects an agent touched carry a small agent dot with attribution in hover or detail ("Optimized by Send-Time Tuner, 2h ago"); no persistent badges.
- The top-bar agent pulse is one quiet dot that animates only when an agent acts; clicking it opens the activity feed. The approvals control is a single count.
- Toasts only for autopilot actions, batched ("Send-Time Tuner adjusted 3 campaigns"), never one per micro-action.

### 11.4 Lead with the 80% use case
- Each view opens on its primary object with one primary action: Campaigns on the board, Content on the composer, Audiences on the segment list, Analytics on the performance overview, Agents on the roster with activity. Dense artifacts (overlap matrices, attribution tables, parameter editors, traces) sit behind tabs or disclosure, closed by default.