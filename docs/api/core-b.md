# core-b API reference (as implemented)

Files: `js/core/models.js`, `segments.js`, `copy.js`, `data.js`, `guardrails.js`. No CSS. Every function is pure over its arguments. None of them use a clock or `Math.random`. Lookups into other namespaces happen at call time.

## models.js (`MC.models`)
- `fitPropensity(world, warmCoef?) -> Float64Array(8)` runs batch gradient descent with lr 0.5 and L2 1e-3 on the intercept-free weights.
  - Cold fit: 60 iterations on `modelState.snap` (features as of day −8), label `lastOrder > snapDay`.
  - Warm fit (`warmCoef` given): 15 iterations, then `snap` = today's features and `snapDay` = today.
  - The result is also stored on `modelState.coef`.
- `scoreProfiles(world)` fills `prop` (`1−(1−p7)^(30/7)`), `churn`, `ltv` (clipped to p99), `bestCh` (255 = none) and `bestHr` (falls back to the global mode below 3 opens), then bumps `profiles`.
- Feature helpers: `featuresOf(world,i,d?)`, `featureMatrix(world,d?)`, `engRate(world,i)`, `recency(world,i,d?)`, `fitLogistic(...)`, `NF`, `FEATURE_LABELS`.
- `explain(world, i, 'prop'|'churn'|'ltv') -> [{label, delta}]` (labels include the profile's values). `unsubRisk(world, i, ch)` follows §10.3.
- `holt(series, {season:7, h, alpha?, beta?})` deseasonalizes with weekly indices and grid-searches α and β over {.1….9}. The phase of `series[0]` is 0.
  - Returns `{fitted, forecast:[{mean, sd, var, lo80, hi80, lo95, hi95}], sigma, alpha, beta, level, trend, indices}`. Series items may be numbers or `{value}`.
- `goalProbability(actualToDate, points, goal)` = Φ((actual + Σmean − goal)/√ΣVar). Variance comes from `var`, `sd` or the band width.
- `ewma(series, {lambda=.2, z=3, minN=7}) -> [{i, value, expected, sd, z, flag}]`, one row per point from `minN` on. `flag` = |z| ≥ z.
- `fitResponse([{spend, revenue}]) -> {A, B, r2, sd, n, prior, meanSpend, meanRevenue}` follows the §5.4 grid. It falls back to the prior when r² < 0.3 or n < 3.
- `response(c, s)`, `marginal(c, s)`.
- `probBest(arms[{a,b}], rng, draws=400) -> number[]` runs Thompson draws. Ties go to the lowest index.
- `attribution(world, {model, fromDay, toDay, campaignIds}) -> {byChannel, byCampaign, total, model}` sums the `attrLast`/`attrLin` day entries.

## segments.js (`MC.segments`)
- `ATTRS` (getter, built lazily from `MC.data`): `[{key, label, group, type, ops, values?:[{value,label}], unit?:'$', fmt(v), min, max, step, pct?, predicted?, phrase}]`. The keys are those of §10.10. `attr(key)` returns one entry. Also exported: `OPS`, `OP_LABEL`, `MAX_DEPTH`.
- `validate(rule) -> string[]`.
- `compile(rule, world?) -> (i)=>bool`.
- `evaluate(world, rule) -> {bits:Uint8Array, count, ms}`. Derived columns are cached on `world._segCols`.
- `members(world, id) -> Uint8Array|null` is cached per segment `ver` and `rev.segCounts` in `world._segCache`.
- `audienceOf(world, campaign)` returns segment ∪ include − suppress. `recount(world, day)`.
- `describe(rule)`, `condLabel(cond)`, `nameFor(rule)` (≤ 48 chars), `leaves(rule)`, `countBits(bits)`.
- `parse(text, world) -> {rule, matched:[{phrase, attr, label, cond}], ignored, confidence}` uses a phrase lexicon, number patterns, state names and codes, and percentile phrases ("top 25%").
- `traits(world, bits) -> {count, reach:{email,sms,push,ads}, hist:{prop,churn,ltv:[{x0,x1,count}]}, region:number[], tier:number[], bestCh:{email,sms,push,none}, bestHr:number[24], sample:int[≤5], meanProp, meanChurn, meanLtv}`.
- `overlap(world, ids) -> {ids, counts, pct}`, where `pct[r][c] = |r∩c| / |r|`.
- `eliminations(world, rule) -> [{path, label, remaining, removedPct (0–1)}]`.

## copy.js (`MC.copy`)
- Constants:
  - `TONES`, `TONE_LABEL`, `OFFERS`, `OFFER_LABEL`, `OFFER_LIFT`, `DISCOUNT`, `OFFER_TEXT`.
  - `LIMITS` (adds headline 70, cta 28, alt 125), `HOOK`, `MAIN` (body field per channel), `FIELDS` (per channel), `FIELD_LABEL`.
  - `TOKENS` ({first_name} {product} {offer} {link}), `IMAGES` (6 × {id, label, alt}), `OPT_OUT`, `DEFAULT_BRAND`.
  - `BANK`, `TONE_MARKERS`, `CAT_WORDS`, `CTA_VERBS`.
- `generate({channel, tone, productId, offer, count(1–8), locks, seedKey, category?}, seed=MC.SEED)`:
  - Returns `[{tmpId:'$v0', channel, name:'A', fields, tone, offer, productId, predicted:{score, open, click}}]`.
  - The rng is `fork(seed,'copy',seedKey)`. Hooks are distinct across variants, every field fits its limit, and SMS always ends with "Reply STOP to opt out." `fields.link` = `fernway.co/<product-slug>`.
- `features(v) -> {channel, hookField, len, hasNumber, personal, urgency, question, ctaStrength, offerStrength, image, grade, caps, toneFit}`. These follow §10.8; `toneFit` is 1, .5 or 0 from tone markers.
- `score(v) -> {score 0–100, predOpen, predClick, logitO, logitC, zO, zC, contributions:[{key, label, delta}], features}`.
  - The z values standardize against bank copy with the same channel and offer, using the channel-wide spread.
  - Contributions are in score points relative to that bank and sum to `score − 50` before the clamp.
- `BANK_STATS` (lazy getter) = `{meanO, sdO, meanC, sdC, n:2000, byChannel, byKey['ch|offer']}`. The top-level means feed `MC.sim.latentFor`.
- `check(v, brand) -> [{id, label, status, detail, fix?:{field, value}}]` covers these ids:
  - `banned`, `length` (hard limits fail; subject, preheader and headline warn), `cta`, `alt`;
  - `grade` (warns above `maxGrade`), `caps`, `offer` (fails when a claim contradicts the offer; warns when the offer is unmentioned), `optout` (SMS only), `tokens`.
- `applyFix(v, fix)` and `fixAll(v, brand)` return new objects.
- `render(v, world, i) -> filled fields + {firstName, productName}`.
- Helpers: `grade(text)`, `measure(text, v)`, `detectTone(text)`, `productOf(id)`, `imageById(id)`.

## data.js (`MC.data`)
- `NEVER = -9999`.
- Taxonomy:
  - `CATEGORIES` and `TIERS` are `{id,label}` (TIERS adds `code`). `REGIONS` are `{id,label,states}`. `STATES` is a string[] of 25.
  - `CHANNELS`. `PRODUCTS` has 24 entries `{id,name,cat,price,margin}`; the first product of each category is its top product.
- `SEGMENTS_SEED`, `CAMPAIGNS_SEED`, `MONTH_GOAL`.
- `journeyTemplate(goalType, channels) -> Step[]` follows §10.7. Spliced steps keep the other ids, so ids can skip (for example no `s5` without push). Paid-only campaigns get entry → exit.
- `generate(seed) -> World` (about 80 ms). `generateSteps(seed).next()` runs one phase per call: profiles, then history, then scores. Each result names the next phase, and the last returns `{done:true, world}`.
- The world it builds:
  - `meta` (with `monthGoal`), `modelState` (60-iteration fit), `seq:0`, `rev`, `catalog`.
  - 6,000 profiles with every column of §4/§10.4, plus `latent.profiles` `{p0, eng, cf, ph, priceSens}`.
  - 9 segments with counts, and 6 campaigns. `campaigns.all` equals `order`. Each campaign has `ctl` mirrored, `include:[]`, `channelPaused:{}` and a `brief` string.
  - 50 variants with ids `v-<cid>-<ch>-<a|b|c>`. Their `ctlStatus` mirrors `status`, and each has `predicted`.
  - `latent.variants` and `latent.curves`. `enroll` covers c-wll and c-lhw (enrolled at t=0) and c-trs (history, exited).
  - `metrics.days` covers −60..0 (organic history plus c-trs). `metrics.hours` is `{}`.
  - Agent entities come from `MC.runtime.newAgentEntity` (or §6.2 fallbacks), with `cooldowns:{}` and zero stats.
  - `proposals {byId, order, open}`, `feed:[]`, `insights:[]`, `audit {entries:[], head:'00000000'}`, `guardrails` (§4) and `log:[]`.
- Retuned targets (§10.10 calibration, agents Off, seed 20261107):
  - c-lhw reactivation 75, c-cks conversions 195, c-bfe revenue 48,000.
  - c-trs is set to about 92% of its simulated history (80 conversions).
  - `monthGoal` = `{revenue:230000, conversions:1700, roas:4.0, unsubRate:0.003}`.

## guardrails.js (`MC.guardrails`)
- `define(id, {label, blocking, immutable?, rule?, fn(world, proposal, def)->{pass, detail}})`. `get(id)`, `list()`, `DEFAULTS` (registry rows) and `BASE` = consent, protectDrafts, targetFresh, holdout.
- `evaluate(world, proposal, def) -> [{id, label, pass, detail, blocking}]` checks `def.guardrails` ∪ `BASE`. Unknown ids are skipped, and a guardrail that throws counts as a failure.
- Registered guardrails: consent, freqCap, quietHours, maxShift, minSample, keepOneLive, budgetCap, protectDrafts, brand, targetFresh, maxSuppress, holdout. Each implements the §6.1 rule on the proposal's actions.
  - `maxShift` covers setAlloc, setBudget and the `variant/create` share.
  - `minSample` covers pauses (lifetime variant sends) and segment support (`params.minSupport`, default 150).
  - `maxSuppress` uses `params.maxSuppressPct` (default 15).
  - `holdout` fails on any `ctl`/`ctlStatus` key in a payload, or on a suppression of control-cohort members.
- `preflight(world, campaignLike, opts?) -> [{id, label, status, detail}]` returns these ids: segment, consent, content, brand, quiet, budget, freqCap (warn only) and start.
  - `opts = {variants?, segment?:{name, rule}}` supports planner drafts that aren't in the world yet. `campaignLike.variants` also works.
