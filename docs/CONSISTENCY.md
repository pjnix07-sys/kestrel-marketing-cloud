# One product, one set of facts (binding for the consistency round)

Sources: docs/review/cross-pollination.md (data × screen audit) and docs/review/agentic-review.md (ten-second test).
Thesis fit: agents can only reason across the business if every screen and every agent reads the same facts, and the
marketer should see one story wherever they look: content, audiences, missions, campaigns, results, team.

## 1. Canonical definitions (one selector each; every surface and agent uses it; no local re-computation)
| Quantity | Definition | Selector |
|---|---|---|
| Campaign revenue | Orders by people enrolled in the campaign, from enrolment to campaign end, attributed last-touch to that campaign's sends | `MC.metrics.campaign(w, cid).revenue` |
| Mission revenue / progress | Sum over the mission's artifact campaigns of the above for the mission's metric | `MC.metrics.mission(w, id)` |
| Reached / sent / delivered | Unique people with ≥1 delivery / sends / deliveries for the campaign or mission | same objects |
| Lift | Treated audience members vs the **universal 5% holdout** members of the same audience, revenue per person over the campaign window, 95% interval; label always says "5% held out" | `MC.metrics.lift(w, {campaignId|missionId|segmentId|blockId})` |
| Message load / fatigue | Sends per person in the trailing 7 days vs the channel cap; people rested by Fatigue Guard count as "rested", never as "nobody over the cap" | `MC.metrics.load(w, scope)` |
| Content lift | Within-campaign contrast (same audience, same time) so audience mix cannot confound angle effects; block rows and the attribute matrix use the same method | `MC.metrics.content(w, opts)` (wraps contentPerformance/contentMatrix) |
| Message count | Distinct messages (not variants, not channel versions); "channel versions" is a separate number | `MC.metrics.messages(w, scope)` |
| Open asks | Open mission asks + pending proposals that are not superseded/expired; one count everywhere | `MC.metrics.asks(w)` |
`MC.metrics` lives in a new `js/core/metrics.js` (loaded after select.js). Existing selectors may delegate to it.

## 2. Stable, live clock
The sample world advances one hour per ~5 s (was 1.2 s), so numbers don't change while you read. Missions are not slowed:
a mission advances one dependency level per tick (independent steps together). Numbers change only on ticks, with the
existing brief highlight.

## 3. Content × audiences (real, simulated)
- Sim: each person has a stable content taste: a preference weight per angle (trail-season, warmth/comfort, gifting,
  practical, urgency-with-deadline) derived from their attributes (e.g. trail runners → trail-season; lapsed hikers →
  warmth; gift givers → gifting after Dec 1; loyal members → practical), plus noise. Block effects = channel effect ×
  person taste. A per-person, per-angle response ledger (exposures, clicks, orders) is kept compactly.
- `MC.affinity` (new `js/core/affinity.js`): `forSegment(w, segId)` → angles ranked with lift and intervals, top blocks for
  this audience, tired blocks for this audience; `forProfile(w, idx)` → content history (blocks seen, responses,
  fatigue per block), predicted best angle; segment rule attribute `respondsTo:<angle>`.
- Audiences: segment detail gets "What this audience responds to" (angles + best blocks + tired blocks, with intervals);
  profile drawer gets content history and fatigue; the rule builder offers "Responds to <angle>" conditions.
- Agents: Segment Scout proposes affinity segments; Copy Drafter and missions pick angles/blocks by the audience's
  affinity; Fatigue Guard uses per-person block exposure.

## 4. Missions as the spine of results and navigation
- Analytics gets "By mission" (progress, revenue, lift, spend, per mission, using §1) and a Content section (same method as
  Content → Intelligence, linking to it).
- Campaign journey steps show the message (blocks + channel version) they send.
- Every object shows and links its mission, the agent that made or last changed it, its content and its audience
  (campaign ↔ mission ↔ segment ↔ message/blocks ↔ agent). Team rows and Asks group by mission.
- Global search (⌘K / "/"): missions, campaigns, audiences, blocks/messages, agents.

## 5. Agentic depth (from the ten-second test)
- Forecast verdict beside the goal: "On pace for 312 of 400 (260 to 365) by Dec 15" from `MC.metrics.mission`.
- Each step records what the agent weighed: options considered with their numbers and why it chose one
  (`step.decision = {options:[{label, value, note}], chose, why}`); the room shows it on the step and in narration.
- Steering shows a diff of what changed (`beat.diff = [{what, from, to}]`), and removing a channel removes it from every
  remaining step, journey and message (bug: SMS lingers today).
- Agents can disagree: e.g. Fatigue Guard vetoes a Copy Drafter send to over-messaged people; Budget Pacer pushes back on
  a spend ask; the disagreement is a beat with both positions and the resolution (rules-based; Claude-written when on).
- Bugs: "$0.00" budget beat; a mission saying "waiting for sign-off" with no ask card; Asks count jumping.
