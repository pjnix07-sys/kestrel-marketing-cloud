# Cross-pollination and consistency audit

Method: code read, plus the app run paused at tick 500 (unpaused it advances 1 hour per 1.2 s, so numbers drift). Screens were compared with selector output.

## 1. Sources of truth
- Missions, steps, asks, beats: `world.missions`. `m.progress` is a daily snapshot (missions.js:1050); live value is `computeProgress` (missions.js:1002).
- Agents, proposals, insights: `world.agents/proposals/insights`; impact via `SEL.agentImpact` (select.js:851).
- Campaigns, spend: `world.campaigns`, `SEL.campaignStats`, `metrics.days`.
- Segments, profiles: `world.segments`, columnar `world.profiles`; rule attributes segments.js:60-80.
- Content: `world.content` blocks, messages, `perf` (day x block x channel, owned only), `fat`, `exp` (per-person exposure count, no outcomes). Variants are the delivery record.
- Consent, fatigue: `profiles.consent/unsub/fatigue/sent7`; `SEL.messageLoad` (cap 4).
- Holdout: `campaign.holdoutPct` (10%) and `meta.universalHoldoutPct` (5%, select.js:520).
- Goals, forecast: `SEL.campaignGoal/forecast`. Events: Analytics chart markers only.

## 2. Matrix
`Y` shown, `-` missing, `!` inconsistent. Mis = mission room, Cmp = campaigns, Aud = audiences, Con = content, Ana = analytics, Prof = profile drawer.

| Entity | Mis | Team | Cmp | Aud | Con | Ana | Prof | Asks |
|---|---|---|---|---|---|---|---|---|
| Mission | Y | Y | "Made by" | "Made by" | - (`whereUsed` returns it, UI drops it) | - | - | mission asks only |
| Agent | Y | Y | Y | Y | Y | Y | - | Y |
| Campaign | draft | - | Y | "Used in" | channels only | Y | last touch name | - |
| Segment | Y | - | Y | Y | - | Y | names | Y |
| Content | card | "13 messages" ! | text only | - | Y | - | - | Y |
| Spend, ROAS | Y ! | - | Y | Y | - | Y ! | - | - |
| Lift, holdout | - | ! | ! | - | - | ! | - | - |
| Fatigue, load | - | Y | ! | - | block only | - | score only | - |
| Events | - | - | dates | - | - | chart | - | - |

## 3. Inconsistencies (tick 500)
1. **BFE revenue.** Mission view and campaign: $32,511 (276 orders). Mission row selector (stored snapshot, select.js:1503): 29,238. Analytics 30-day channel table sums to $88.2k, last-touch attribution to $112.6k, KPI month to $177.5k (includes organic). Definitions are not reconciled on screen.
2. **Holdout.** Cards: "Holdout 10%, about 87 people" (campaigns.js:176); Analytics: "10% control group" (analytics.js:665). The lift selector uses the 5% universal holdout: 37 (BFE), 86 (WLL), 39 (LHW).
3. **Lift vs ROAS.** WLL ROAS 3.5x, "$27.8k of $38k", but lift -42% ("clearly below", $42.80 vs $73.62). All ready campaigns are negative. Probably a comparator problem; either way it undermines the "$ back" headline.
4. **Agent impact.** Roster stats: Optimizer realized $1,224. Analytics: "Agents added $0 realized (expected +$2,407)". Team: "not enough data yet".
5. **Message load.** BFE audience tab: "Nobody is over the cap" (campaigns.js:744, `overCap` 0). Fatigue Guard rested 118 "over-messaged" people on it (unsub-risk rule, guard.js:41).
6. **Content signals.** Intelligence matrix: urgency -18% in email; same page: "Early access through Friday" (urgency) +40% vs rest, because it only ran to Summit members (audience confound). Campaign Content tab rings (A 67, B 5, C 9) are the legacy `MC.copy.score`, opposite to observed results.
7. **"Message".** Copy Drafter "13 messages" (data.js:794 counts variants); mission card "3 messages"; Content "18 messages, 45 blocks". "Variant A" vs "message (A)".
8. **Stale narration.** Scout beat "Found 743 lapsed hikers"; segment 697.
9. **Asks.** Header 12 = 1 mission ask + 11 proposals; proposals carry no mission; two near-duplicate Scout segments (LTV >= $290: 1,215; >= $140: 1,790) beside existing High predicted LTV (>= $480: 778).
10. **Team vs missions.** Optimizer "Not on a mission" after 16 applied changes (many on BFE); Lead "Hand-offs: None yet" vs "3 steps handed out".
11. **Lifecycle.** Mission "running, monitoring" on the last day; campaign "At risk, no more sends scheduled".

## 4. Simulation today, and the change needed
Block effect = `W[kind] * (noise + angleFx(angle, channel, day, daysLeft))` (sim.js:205), with per-person exposure decay in `planFx`. Nothing depends on who the person is, except product-category affinity and channel fit at click time (sim.js:687-689), neither content-aware. Ledger has no audience dimension; paid channels get no rows.

Needed for real per-audience effects:
1. `LP.taste` (n x angles), seeded `rng.fork(seed,'taste',i)`, derived from observable traits so segmentation can find it (trail-season from `affHike/affRun`; warmth from `affApparel`, region, tier; gifting from orders/AOV; urgency from price sensitivity; utility from `affCamp`).
2. `planFx`: add `tau * (taste[i][angle] - mean)` for angle-tagged headline and body blocks, on top of the channel effect.
3. Per-person response ledger `content.resp[angle]` (delivered/click/conv) beside `exp`; selectors aggregate over any segment bitset, so user-built segments work (no fixed cohorts).
4. Segment attributes from it: `respondsTrailSeason`, `respondsWarmth`, `respondsUrgency`, `blocksSeen`, shrunk to a prior.

## 5. Ranked opportunities
1. **Content x segments (high; L).** After section 4: `SEL.segmentContentAffinity(w, segId)` and `profileContentAffinity(w, idx)` using `rateRatio` intervals. UI: "Responds to" on segment detail, an affinity row in the profile drawer, segment x angle grid on Intelligence, rule "responds to trail-season content" in the builder. Files: data.js, sim.js, segments.js, select.js, audiences.js, content.js. Thesis: Drafter, Scout and Lead choose blocks per audience; user sees one story.
2. **One revenue and lift truth (high; M).** `SEL.campaignResult` with one definition and label for mission, campaign, analytics and team; fix holdout size and wording and the lift comparator.
3. **Mission results in Analytics (high; S-M).** "By mission" filter and section (revenue, lift, agent changes, content used), linking to the room. Data is in `artifacts` and `campaignStats`.
4. **Content in Analytics (high; M).** Content section (angle x channel, fatigue, agent-change markers). Fix audience confounding with within-campaign contrast (`contentContrast`).
5. **Journey and mission show messages (medium; S).** Journey step nodes show message, headline and version, linking to Compose; replace legacy rings with observed variant lift.
6. **Content x missions and agents (medium; S).** "Used in missions" on Library and Compose; authoring agent and requesting mission in block history.
7. **One fatigue definition (medium; M).** Shared by Guard, audience tab and profile; per-person block exposure ("seen this headline 3 times") in drawer and segment page.
8. **Holdout lift x content and segments (medium; L).** Needs `content.resp` plus per-segment holdout revenue.
9. **Asks and Team tied to missions (medium; S).** Stamp `missionId` on proposals, group Asks by mission, dedupe segment proposals, derive "On <mission>" from applied changes, fix hand-off counts.
10. **Navigation (medium; S-M).** Lead column chips (`console.js:140` handles only campaign, variant, segment) for mission, agent, block, profile; every object links to its mission, agent, content and audience. There is no global find-an-object search.
11. **Live references in narration (S).** Beats quote `{segment:s-lapsed}`, not frozen counts.

