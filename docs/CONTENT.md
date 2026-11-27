# Content as data (binding for the content rebuild; option C)

## Thesis fit
Content is structured, channel-neutral data that agents assemble, reuse and learn from across every channel. People
write once; every channel renders from the same source; performance is measured per piece across channels, and the
agents act on what they learn. No CMS admin vocabulary in the UI ("content type", "space", "entry", "environment").
Words we use: **message**, **block**, **channel version**, **used in**, **library**.

## Model (`js/core/content.js`, world slice `content`, logged catalog actions)
```
Block   = { id, kind: 'headline'|'body'|'offer'|'cta'|'image'|'product'|'claim'|'signoff',
            value: string | {…kind-specific}, tags: { angle, tone, product?, offerType?, season? },
            locale: 'en-US', ver, review: 'draft'|'in_review'|'changes'|'approved', author, createdTick,
            history: [{ver, value, by, tick, note}] }
Message = { id, name, slots: { headline, body, offer?, cta, image?, product?, claims: [] , signoff? } -> blockIds,
            channelOverrides: { [channel]: { [slot]: blockId } },      // e.g. a shorter headline for SMS/push
            tags, ver, review, author, createdTick }
Channel version (computed, never stored as truth): MC.content.render(world, messageId, channel, {profile?, locale?})
  -> { channel, fields: {subject, preheader, body, cta, sms, pushTitle, pushBody, socialHeadline, socialText, alt…},
       blocksUsed: [blockId], checks: MC.copy.check result, limits }
```
- Channels: email, sms, push, social, web (web = landing/hero), in-app optional later.
- Renderers respect existing limits (`MC.copy.LIMITS`), opt-out text, GSM-7/UCS-2 segmenting, token fallbacks.
- **Variants stay as the delivery record** (so sim, optimizer, review and analytics keep working): a variant now carries
  `messageId` and `channel`, and its `fields` are the rendered channel version at publish time (`renderedVer`). Editing a
  block that a live variant uses creates a "newer version available" state on that variant; publishing re-renders.
- Seed: migrate today's seeded variants into ~40 blocks and ~12 messages with realistic reuse (the same offer, CTA and
  claim blocks across campaigns; 3–4 headline angles: trail-season, warmth/comfort, gifting, urgency-with-deadline).

Actions: `block/create|update|setReview|archive`, `message/create|update|setSlot|setOverride|setReview`,
`message/publish {id, campaignId, channels[]}` (renders and creates/updates variants), `block/retire {id, reason}`
(stops new use; agents swap it out of live messages through normal proposals).

## Simulation truth (so analytics finds something real)
Each block gets seeded latent effects in `sim.latentFor`: a base effect plus a channel interaction (e.g. trail-season
headlines are strong in email and push, weak in SMS; urgency only helps with a real deadline; gifting rises after
Dec 1), and a reuse-fatigue decay by cumulative exposures of that block to the same person. A variant's quality is the
combination of its blocks' effects for its channel. Deterministic and seeded; no number is invented in the UI.

## Content intelligence (`MC.select`)
- `contentPerformance(world, {by: 'block'|'angle'|'tone'|'offerType'|'image', channel?, days?})` →
  rows with exposures, clicks, conversions, revenue per send, lift vs channel baseline with interval, trend.
- `contentMatrix(world, {dim: 'angle'})` → attribute × channel grid of lift (with intervals and "not enough data").
- `blockFatigue(world, blockId)` → exposures per person distribution, decay curve, "tired since".
- `whereUsed(world, blockId)` → messages, campaigns, channels, missions.
- `contentRecommendations(world)` → evidence-backed suggestions used by agents.

## Agents
- **Copy Drafter** writes blocks (headlines/bodies/CTAs with tags), composes messages from approved blocks, and asks
  for review; new words never auto-apply.
- **Variant Optimizer** tests at block level across channels (e.g. two headline blocks in every channel at once) and
  reads results from `contentPerformance`.
- **Fatigue Guard** also watches block fatigue and proposes retiring a tired block everywhere it runs (one proposal,
  all placements listed).
- **Insight Analyst** writes content insights ("Trail-season headlines beat urgency by 18% in email and push; no
  difference in SMS") with the interval.
- **Lead / missions** assemble missions' messages from the best approved blocks for the audience and channels.
- With Claude connected, Haiku writes and tags blocks; the grounding rules still apply.

## Surfaces
1. **Mission room:** the message artifact shows the message's blocks and its channel versions side by side; a hand-off
   baton reads e.g. "1 message · 5 channels".
2. **Content (Artifacts):** three tabs: **Library** (blocks and messages, filters by kind/angle/review/channel, "used in N
   places", performance sparkline), **Compose** (edit a message once; every channel version renders side by side live;
   editing a shared block warns "used in 7 places" and offers "change everywhere" or "fork for this message"; review,
   versions with diff, locale switch; a "Data" toggle shows the JSON each channel receives), **Intelligence**
   (attribute × channel lift matrix, top and tired blocks, reuse fatigue curves, the agents' recommendations with
   Approve).
3. **Team:** agents' content work appears in their "right now" and record.
Design: docs/DESIGN-DIRECTION.md; no tiles, no CMS jargon.
