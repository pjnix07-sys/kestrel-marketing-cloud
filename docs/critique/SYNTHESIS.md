# What the marketing team told us, and what we're changing

Five reviewers (marketing ops, content, CRM/lifecycle, design, campaign management) used the prototype and read the plan.
Their critiques are in this folder. This page is the decision: what we build now, what we park, and the shared interfaces
the builders code against.

## What they agreed on

1. **The numbers contradict each other.** Goal $230k on Home vs $140k in the plan, "100% chance" on day 2, "Off track" in red
   with "not enough history", a funnel that reads "631% of opened", Outlook and Analyst disagreeing on the same campaign.
   A team stops trusting a screen like that within a week. *(ops, campaigns, design)*
2. **Nothing gets checked before it sends.** No test send, no launch checklist, no review states for copy, no named approver.
   *(ops, content, campaigns)*
3. **Lift is hidden.** The 10% control group only scores agent actions; the marketer never sees "this campaign drove +X% vs
   control". *(CRM, ops)*
4. **Customers are counted per campaign, not per person.** No view of how many messages one customer gets across
   overlapping campaigns, no collision warning before launch. *(CRM, campaigns)*
5. **Claims checking is cosmetic** and the score rewards false urgency; SMS shows "opens". *(content)*
6. **Agents act before they've earned it,** and the Command Center buries what they did. *(CRM, campaigns, design)*
7. **It looks competent but generic:** identical bordered boxes, no signature moment, a remaining left stripe, clipped theme
   switch, uppercase labels. *(design)*
8. **The AI layer needs a data policy:** only aggregates leave the browser, every run says whether rules or AI decided, and
   AI-written copy always needs a person's approval. *(ops, content)*

Already fixed while they reviewed: holiday dates (the season now runs on the real 2026 calendar, Black Friday is
Fri, Nov 27) and the cold open (the sample world catches up to today's date and hour, so agents have a history).

## Build now

| # | Change | Owner lane |
|---|---|---|
| 1 | One source of truth for goals and pacing: per-month goals, "Too early" instead of a status until 7 days of data, "expected by now" figures, fixed funnel math, Outlook and Analyst on one selector, honest 24h agent counter | Metrics |
| 2 | Command Center rebuilt around a **morning brief** (one sentence in the display face) and the **journey line**: the day's revenue drawn as a line with russet nodes where agents acted; click a node to see what changed. Feed first; only agents that acted or need you; neutral states until pacing means something; stacked rows on phones | Home |
| 3 | Per-campaign **lift vs control** card with an interval; **message load** per customer across campaigns and a **collision warning** before scheduling; always-on **programs** shown apart from dated campaigns; a **wrap report** when a campaign completes | Campaigns |
| 4 | Content: a **claims registry** in the brand book with checks for superlatives, unbacked scarcity and urgency without an end date; no urgency credit without an offer deadline; SMS shows clicks not opens; GSM-7 vs Unicode segment counting; per-token fallbacks; generated variants deduped against live ones and editable before adding; a Brand voice page that also feeds Haiku | Content |
| 5 | **Readiness and review:** launch checklist on each campaign (test send, links and UTMs, legal, consent) that Schedule requires; copy review states (Draft, In review, Changes requested, Approved); a "Viewing as" persona switcher with roles; approver name and note on approvals and dismissals; "Expired unreviewed" shown | Governance (after AI core) |
| 6 | Agents earn trust: Send-Time Tuner defaults to Suggest; Optimizer stays on Autopilot but only moves traffic between approved variants; Budget Pacer and Fatigue Guard calibrated so they act on the sample data; journey step counts fixed | Agents & sim |
| 7 | Design system: one self-hosted typeface (Schibsted Grotesk) with tabular figures; borderless surfaces with a border only on the primary object; theme switch fixed; sentence-case labels; the last left stripe, glow ring and digest fields in the agent kit removed; chart dates on the real calendar; bare journey-line mark in the sidebar | Design system |
| 8 | AI layer: Connect panel (key in this browser only, data policy shown), AI or Rules label on every run, per-agent "rules only" lock, Haiku wired into Content, Planner and Audiences | AI UI (after AI core) |
| 9 | React and htm served from the repo, so the Pages site never depends on a third-party CDN | Release |

## Parked (and why)

- Real connectors, reverse-ETL, SSO/SCIM, per-field permissions: a static prototype can't prove them; a persona switcher proves the governance model.
- Multi-touch attribution or MMM: holdout lift is the more honest headline.
- Drag-and-drop journey canvas or calendar editing: the step list and planner are the right level.
- More agents: eight is already more than a five-person team can supervise.
- Sentiment dials, AI-detector scores, sparkle badges, a free-form chat box in the composer.
- Full deliverability modelling and per-profile consent provenance: worth doing next, but they need a deeper sim change.

## Shared interfaces (builders code against these; guard calls with `typeof`)

Metrics lane adds to `MC.select` (pure, world in, plain objects out, no store reads):

- `goalFor(world, monthKey?)` → `{ key, label, target, actual, expectedByNow, delta, status: 'early'|'ahead'|'on'|'behind', p: number|null, days: {elapsed, total} }`. `status` is `'early'` and `p` is `null` until 7 days of the month have data.
- `campaignPacing(world, cid)` → `{ target, actual, expectedByNow, delta, status, recoverNote: string|null }`.
- `campaignLift(world, cid)` → `{ ready, metric: 'revenue per person', treated, control, liftPct, lo, hi, nTreated, nControl, note }`.
- `messageLoad(world, {days = 7} = {})` → `{ days, cap, distribution: [{sends, profiles}], overCap, byCampaign: {[cid]: sends} }`.
- `collisions(world, cid)` → `[{ otherId, otherName, channel, overlapPct, fromDay, toDay }]` (live or scheduled campaigns that share audience and channel with `cid` in overlapping days).
- `agentActivity(world, {hours = 24} = {})` → `{ applied, proposed, pending, byAgent: {[id]: {applied, proposed, lastTick}} }`.

Agents & sim lane adds `campaign.program = { trigger, exit, reentryDays }` in `data.js` on always-on programs (the win-back), and makes `world.meta.monthGoal` hold separate November and December targets that match what the season can plausibly reach.
