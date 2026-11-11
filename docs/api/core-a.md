# core-a API reference (as implemented)

Files: `js/core/namespace.js`, `util.js`, `time.js`, `rng.js`, `catalog.js`, `store.js`, `select.js`. No CSS classes. All functions are safe to call at render or call time. Nothing here reads another builder's namespace at load time.

## namespace.js
- `MC.VERSION`, `MC.SEED = 20261107`, `MC.TENANT`, `MC.html` (set only if `htm` and `React` loaded).
- Buckets (created, never overwritten): `views agents ui charts icons hooks dev planner util fmt time rng catalog store uiStore nav select`.
- `MC.CH = {ALL, OWNED, PAID, IDX, BIT, LABEL}`, `MC.F = {SENT..REACT, LEN:10}`, `MC.ROUTES`, `MC.AGENT_IDS`.
- `MC.contract.require(path)` returns the value or throws `"MC.x.y missing (owner: core)"`. `check()` returns `{missing:[...paths, 'agent:<id>']}`. Also exposes `REQUIRED` and `lookup(path)`.

## util.js
- `MC.util`: `fnv1a(str,h?)`, `fnvBytes(typed,h?)`, `hex8(u32)`, `canon(v)` (§10.11 exact), `digest(v)`, `now()` (the only `performance.now` caller), `clamp lerp sigmoid logit round sum mean sd quantile(sorted,q) argmax`, `stableSort(arr,cmp)` (ties by `.id`, then by input order), `shallowEqual arrayEqual deepEqual(canon-based)`, `clone(v)` (deep, copies typed arrays), `isTyped(v)`, `normCdf(z)`, `wilson(k,n,z=1.96)->[lo,hi]`, `memo(fn,keyFn?)`, `bump(world,...keys)`.
- `MC.fmt` (no Intl; em dash `—` for null or NaN):
  - `money(n,{compact,cents,sign})` gives "$1,860", "$412k" or "$12.4k". Negatives use an ASCII `-`.
  - `num(n,{compact,dp,sign})`, `pct(p,dp=1)` "4.1%", `pp(d)` "+0.6 pp" (d is a fraction), `delta(r,dp=1)` "+6.2%", `ratio(x,dp=1)` "5.8×", `range(lo,hi,f=money compact)`.
  - Tick formatters: `date(tick)` "Sat, Nov 7", `time(tick)` "14:00", `stamp(tick)` "Nov 7 · 14:00", `clock(tick)` "Sat, Nov 7 · 14:00".
  - Day formatters: `dayLabel(day)` "Sat, Nov 7", `dayShort(day)` "Nov 7".
  - `rel(from,now)` "3h ago", "in 4h", "2d ago" or "just now". `hour(h)` "7 pm".

## time.js
- `DAY0=-60`, `dayIndex(d)`, `dayOf(t)`, `hourOf(t)`, `tickOf(day,hour)`, `simDay(t)`.
- `dow(t)` takes a tick (0 = Sun, `dow(0)=6`). `dowOfDay(day)` takes a day.
- `calendar(day) -> {y,m(1-12),d,dow,label}`, `ymd(day)`, `dayOfYmd(str)` (null if invalid).
- `monthOf(day) -> {y,m,label:'Nov',name:'November',fromDay,toDay,days}`.
- `inQuiet(h,quiet)`, `EVENTS`, `eventOn(day)`, plus `MONTHS`, `MONTH_NAMES` and `DOWS`.

## rng.js
- `MC.rng.create(seed)` and `fork(seed,...keys)` follow §10.3. `MC.rng.Rng` is the class.
- Rng methods: `next() float() open() int(n) range(a,b) normal(mu,sd) gamma(k) beta(a,b) bernoulli(p) binomial(n,p) poisson(lam) lognormal(mu,sd) pick(arr) weighted(ws) shuffle(arr) sampleIdx(n,k)`.
- `open()` returns a value in (0,1).
- `weighted` returns **-1** when every weight is ≤ 0. It always consumes 1 draw.

## catalog.js
- `define(type, {by, label, entity(p,created), validate(world,p,ctx), reduce(world,p,ctx), inverse(world,p,ctx), describe(world,p)})`. The ctx is `{origin, tick, user, agent, agentId, created[]}`.
- `get(type)`, `types()`, `originAllowed(type,origin)`.
- `apply(world, action, {origin,tick}) -> {ok, error?, created?, inverse?}`. On success, `inverse` is the concrete undo list with real ids.
- `inverse(world, action, meta?) -> action[]`. Ids the action will create appear as `'$created:k'`. Use `substituteCreated(actions, created)` to fill them in.
- `dispatchUser(world, action)` follows §10.3. It clones the payload, rejects `restoreId`/`restoreVariants`, logs, and adds a `user` feed item.
- Other exports: `reduce(world,action,meta) -> world`, `describe(world, action)`, `addFeed(world,item)`, `closeProposal(world,p,patch)`, `isStale(world,p)`, `entityById(world,id)`, `cooldownKey(p)`, `paramErr(def,key,val)`, `defaultParams(def)`, `segmentInUse(world,id)`, `variantsOf(world,cid,ch?)`, `stepsErr(steps)`, `agentName(id)`, and the constant lists `GOALS TONES OFFERS FIELD_KEYS CADENCES GOAL_LABEL`.
- Types: every type in §4 and §10.5. `by` is `['user','agent:*']` for every type an agent can emit **or needs as an undo inverse**: setAlloc, setSendHour, setBudget, setEnd, suppress, include, setChannelPaused, variant create/setStatus, segment create/remove, and profiles suppress/release. The runtime's `def.emits` restricts what each agent may propose. `campaign/create` and `remove` allow `agent:planner`. `campaign/setStatus` allows `user` and `sim`.
- Agents never touch draft campaigns. This is enforced in `validate` for every campaign-targeting action except the planner's create/remove.
- `draft→scheduled` promotes the campaign's `draft` variants to `live`; `scheduled→draft` reverses it. `scheduled→live` (sim) calls `MC.sim.enroll`.
- When agents add a variant (`variant/create`), it gets status `live` and `ctlStatus:'draft'`.
- When a variant goes live while the channel allocation is empty, it receives share 1.
- Proposal actions follow §10.5:
  - The catalog sets `applied` or `stale` and the `approved`/`rejected`/`undone` feed items.
  - It updates `stats.rejected` and `stats.undone`, and the cooldowns.
  - A rejected proposal keeps `dismissReason`; an undone one gets `undoneTick`.
- `guardrails/update` adds `ver`, `updatedBy` and `updatedTick` to `world.guardrails`.

## store.js
- `MC.store`: `init(world)` (synchronous notify), `getState()`, `version()`, `subscribe(fn)->unsub`, `dispatch(action)` (microtask notify), `applyInternal(action, origin='runtime')`, `batch(fn)` (always one synchronous notify at the end of the outermost batch), `bump(key)`, `notify()`.
- `MC.uiStore`:
  - `getState()`, `version()`, `subscribe(fn)`, `set(patch|fn)` (shallow merge, synchronous notify).
  - Helpers: `setFocus(view, patch)`, `setNotify(agentId, level)`, `addToast(t) -> id` (keeps the last 3), `dismissToast(id)`, `clearToasts()`, `applyTheme(theme)`, `reset()`.
  - It persists `{theme, route, sampleDismissed, notify}` under `kestrel.ui.v1` with try/catch. On a bare URL it restores the persisted route; an unknown hash goes to `home`. `notify` defaults to `'changes'` for all 8 agents.
- `MC.nav.go(route, focusPatch?)`, `MC.nav.route()`, `MC.nav.ROUTES`. It also installs a `hashchange` listener.
- `MC.hooks`:
  - `useSelect(sel, eq=Object.is)` returns undefined before `init`. `useShallow(sel)`, `useUi(sel?, eq)`, `useTick()`.
  - `useDraft(source, {eq=deepEqual, onCommit}) -> {value,set,dirty,commit(),reset(),conflict,theirs,takeTheirs(),keepMine()}`. `commit` returns onCommit's result and adopts the value unless `ok===false`.
  - `useFrozen(list, {key='id'|fn, freeze}) -> {items,pending,reveal()}`. Frozen rows still update their values by key.
  - `useDebounced(value, ms=150)`.

## select.js
All selectors are memoized on world, rev and args, and return the shapes in §10.13. Notes:
- `f = {metric, campaignIds?, channel?, fromDay?, toDay?, range?:14|30|60|'all', h?, model?, month?}`.
  - Metrics: revenue, conversions, clicks, sends, opens, delivered, cost, unsubs, impressions, react, plus ratios roas, ctr, openRate, convRate, unsubRate.
  - Without filters, sums use `day.tot`. Any campaign or channel filter, and ROAS, sums campaign entries.
- `forecast(w,{month:true,metric})` returns `{actual, points, cumulative:{actualToDate, projected:{mean,lo80,hi80,lo95,hi95}, actual:[cum], points:[cum]}, goal, p, month, today, ready}`. It falls back to a 14-day mean forecast when Holt is unavailable (then `ready:false`).
- `forecast(w,f)` without `month` returns `{actual, points, ready, goal?, goalTarget?}`. `points` is empty with fewer than 7 complete days. `goal` is a daily target, present only for a single campaign whose goal metric matches.
- `campaignGoal` adds `metric`, `projected` and `daysLeft`. `outlookPct` and `p` are null before a campaign has data.
- `campaignStats` adds `opens`, `unsubs` and `impressions`. `pace` = spend ÷ (budget × elapsed fraction).
- `variantStats` adds `reward`. `pBest` uses `fork(seed,'ui','pbest',cid,ch,tick)` with 400 draws, and is null for non-live variants. `prevShare` comes from an applied setAlloc inverse in the last 24h.
- `agentRoster` adds `agentStatus`, `cadence`, `icon`, `stats` and `ranThisTick`.
- `agentImpact` rows add `kind`, `unit`, `realizedLo` and `realizedHi`.
- `segmentRows` adds `ver`. `profileRow` adds label fields, `lastOrderDay` and `suppressedUntil`.
- `feed(w,{kinds,entityId,agentId})`, `insights(w,{kinds,includeDismissed,entityId})`.
- Extras: `MC.select.targetCampaignId(w, proposal)`, `MC.select._clear()`.
