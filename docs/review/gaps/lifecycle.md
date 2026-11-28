# Lifecycle / CRM review (Braze, Klaviyo, SFMC background)

Verified in the live app (Playwright, detail=detailed) and code. Screenshots in gap/lifecycle/: journey.png, profiles.png, builder.png, camp.png.

## 1. Day-one jobs
| Job | Could I? |
|---|---|
| Stand up a welcome series on signup | No. Journeys exist only inside a Campaign, started from an audience. No "person signs up" trigger. |
| Abandoned cart / browse / post-purchase flows | No. Zero matches for abandon/browse/post-purchase in js/. Only 1 sample program (Lapsed Hiker Win-back, `program: {trigger:'No order in 120 days', exit, reentryDays}`, data.js:437). |
| Win-back with exit-on-purchase and re-entry window | Partly. Win-back is the one real always-on program: Campaigns > Programs section, Journey tab shows entry/send/wait/decide/exit with live counts. Trigger/exit/re-entry are free-text strings, not editable rules. |
| Set frequency cap, quiet hours, suppression globally | Partly. Agents > Guardrails has quiet hours (21-8, sms/push only) and 7-day cap (email 4 / sms 2 / push 5), per-channel only. No per-journey or per-category cap, no timezone-per-profile quiet hours, no email quiet hours by default. |
| Handle consent / unsubscribe / preference center | Partly. Per-profile consent flags E/S/P/A (Audiences > Profiles) and sim honours consent+unsub bits (sim.js:521). No preference center, no topics/subscription groups, no double opt-in, no unsubscribe link/list-unsubscribe, no way to see or edit an unsub. |
| Check deliverability (domain auth, warm-up, bounces, complaints, inbox placement) | No. "deliverab", "DKIM", "SPF" appear nowhere in js/. |
| Test a journey (A/B a step, per-journey holdout) | Partly. Variants A/B/C per send step; a global 5% holdout slider (Agents guardrails) and "holdout lift" in Results. Can't set a holdout or split on a path in the journey itself. |
| Segment on behaviour/events (viewed X, no purchase in 7d, cart value > $) | Partly/No. Builder is attribute-based (tenure, LTV, tier, propensity, last order). No event stream, no "did / did not do within N days" operators (confirm in builder.png). |

## 2. Missing sections
1. **Data & Events (blocker).** What: connect sources, event schema (signup, view, add_to_cart, order), identity resolution (email/phone/device merge), attribute ingestion, data health. Why: every lifecycle flow starts with an event; today nothing can enter a journey except an audience snapshot. Incumbents: Braze Data Transformation + Currents, Klaviyo integrations/metrics, SFMC Data Extensions/Contact Builder. Agent-first: agent proposes "I found a cart event with no consumer; want an abandoned-cart flow?" and flags schema drift/duplicate profiles as decisions. Blocker.
2. **Compliance & Deliverability (blocker for email).** What: sender domain auth, IP/domain warm-up plan, bounce/complaint/unsub rates by mailbox provider, suppression list (hard bounces, complaints), CAN-SPAM/GDPR/TCPA footers, double opt-in. Why: one bad blast ruins the domain. Incumbents: SFMC Deliverability, Braze/SparkPost reporting, Klaviyo dashboard. Agent-first: a "Sender health" agent that throttles, warms, pauses a campaign and asks for a decision only when a reputation threshold is at risk. Blocker.
3. **Preference center / subscription topics (major).** Per-customer topics and frequency choices, hosted page, one-click unsubscribe, SMS STOP/HELP keywords. Agent-first: agent reads unsub reasons and proposes a new topic ("Gear alerts only") instead of losing the whole channel.
4. **Transactional vs promotional separation (major).** Order confirmation / shipping / password reset must bypass promo caps and quiet hours and never be agent-edited for offers. Not modelled at all ("transactional" 0 hits). Need a message class that guardrails treat differently.
5. **Lifecycle programs library (major).** A place that lists always-on flows (welcome, cart, browse, post-purchase, replenishment, birthday, win-back, VIP) with status, health and entry/exit. Today "Programs" is a sub-section of Campaigns with one card. Agent-first: "Lifecycle coverage" view showing moments with no flow, and the agent drafts the gap flow.

## 3. Gaps inside existing sections
- **Journey editor (campaigns.js ~1079-1145, major).** Step types are only entry/send/wait/decide/exit. Decide rules are a fixed list (opened, clicked, purchased, consent, propensity, bestChannel, campaigns.js:1134). No add/delete/reorder step in the UI I saw (only select and adjust); no multi-way branch, no random A/B split node, no wait-until-event/time-of-day, no "exit on goal" setting separate from a purchased-decision, no webhook/tag/update-profile action, no push/in-app/web steps beyond email/sms/push. Agent-first: agent proposes the journey as a diff the user approves.
- **Entry/exit/re-entry (data.js:437, major).** Trigger, exit and reentryDays are strings on `program`, not editable fields with audience-size preview. No "enter once vs every time", no priority between flows when a person qualifies for two (only warns on freq-cap overlap, guardrails.js:458).
- **Frequency cap (guardrails.js:139, major).** One cap per channel across the workspace; no marketing-vs-lifecycle split, no per-journey override, no "max 1 message per day" across channels, no priority rules (cart flow beats newsletter).
- **Quiet hours (minor/major).** Single global window, default applies to SMS/push only; not per recipient time zone (profiles carry a region like "MN · Midwest"). Best-hour 9 pm shown for SMS profiles in Profiles tab suggests clamp is applied at send, not shown to user.
- **Consent (audiences.js:1024, major).** Four booleans. No source/timestamp/IP/proof of consent, no consent history, no channel-level unsub reason, no regional rules (GDPR/CCPA). Unsub counts only show as a metric.
- **Segmentation (minor-major).** No behavioural/time-windowed conditions, no nested AND/OR depth confirmed in the builder, no segments from a journey ("opened but didn't click"), no exclusion lists/import, no dynamic vs static distinction.
- **Test + holdout (major).** Holdout is a workspace-wide percent that agents must not change; no per-journey holdout, no long-term holdout reporting, no test significance shown on the journey step.
- **Journey stats.** Counts are "in step / today". Missing conversion by step, drop-off %, time-in-step, and why people exited. Note: Journey tab showed Exit 772 vs 5 in the Decide step with 0 elsewhere; hard to tell what is stuck.

## 4. Confusing / felt fake
- "Win-back" has Campaign status Live Nov 7 - Dec 2 with an end date, while Programs are described as "no end date" (campaigns.js:470). It is the same object, so lifecycle vs campaign is blurred. A goal-time-boxed "wave" model contradicts an always-on program.
- Home decision: "Wave 1 stops Dec 2, extend to Dec 14?" is sensible but is a campaign decision; I found no way to see what happens to people mid-journey on the date change. journey.png.
- Profiles tab shows churn 94% and propensity 3% for a person with a 468-day-old order marked "SMS best channel"; plausible, but there is no event timeline to see why. profiles.png.
- Trust: nothing shows a sent message's actual unsubscribe link or footer, so "consent respected" is a green check I cannot audit.

## 5. Unmistakably agentic and memorable for lifecycle
1. **"Moments map"**: one screen of the customer lifecycle (sign up, first order, repeat, lapse, win-back) with an agent per gap saying "no flow here; 1,140 people hit this last month" and a Draft it button that produces the full journey, copy and holdout for one approval.
2. **Journey diff approvals**: agent edits to a live journey show as a visual diff on the diagram with "who is affected right now: 212 in step" before and projected unsub/complaint risk after. Approve / leave.
3. **Fatigue ledger per person**: click any profile and see why the agents held back or sent each message (cap, quiet hours, consent, priority), in plain sentences. Makes guardrails visible and trustworthy.

## 6. Top 5
1. Event data + identity layer (no triggers means no real lifecycle; blocker).
2. Always-on Programs as a first-class section with welcome/cart/browse/post-purchase/birthday library and editable entry/exit/re-entry (blocker).
3. Compliance and deliverability: sender auth, warm-up, bounce/complaint suppression, unsubscribe/footer proof (blocker for email).
4. Preference center + consent records + transactional vs promotional message class (major).
5. Richer journey builder (add/remove steps, A/B split, wait-until-event, per-journey cap/holdout/priority) with agent-proposed diffs (major).
