# Marketing Ops critique

## 1. Verdict

The trust mechanics are better than most real tools: proposals carry Why, Expected impact, Guardrails and a Changes diff, autopilot is limited by risk, undo checks for staleness, and a control cohort measures lift. Those choices would hold up in an ops review. What would fail is everything around a send. There is no test or seed send, no named approver or roles, consent is a bare on/off bit with no source or timestamp, deliverability is a fixed constant, and the KPI and forecast numbers contradict each other often enough that a team would stop trusting the screen within a week. Fix how credible the numbers look and who signs off on what before adding any more agent cleverness.

## 2. Top 8 issues (by impact)

**1. No people in the approval loop.** The audit records that something was approved, but not who approved it, why, or under what authority. There are no roles. A real team separates Admin, Campaign manager, Approver (legal/brand) and Analyst (read-only). It also requires two people to sign off on high-risk changes (`pause-channel`, `retarget`, budget moves over 10%). *Change:* add a synthetic team of 5 personas and a "Viewing as" switcher in the footer. Add `by` and `note` to every logged user action, and gate approve buttons by role. "Approve all low-risk" should be hidden from Analysts. High-risk proposals show "Needs a second approver".

**2. Nothing can be tested before it sends.** There is no seed list, test send, proof or preview-with-real-profile sign-off, and no launch checklist on the campaign. Scheduling a campaign is gated only by the planner's preflight. *Change:* add a Seed list in Guardrails (5 internal addresses). Add a "Send test" action in Content Studio that writes a feed item ("Test sent to 5 seeds"). Add a launch checklist on campaign detail (test sent, links checked, legal approved, UTM set) that `Schedule` requires. Agent-created variants (Copy Drafter) go through the same checklist before they get traffic. Today they go live at 10% the moment someone approves them.

**3. The consent model would fail a legal review.** `consent:Uint8` has no source, timestamp, lawful basis, double opt-in state or jurisdiction. Quiet hours use one global clock even though profiles span MN to CA. TCPA quiet hours are about the recipient's local time, and the profile table shows SMS best-hours of 6–7 am. *Change:* give each profile a timezone derived from its state and apply quiet hours in that local time. In the profile drawer, show consent provenance per channel ("SMS: opted in via checkout, Mar 3 2026, double opt-in ✓"). Add a global suppression list tab (unsubscribed, hard bounced, complained, legal hold) that the consent guardrail reads.

**4. Deliverability isn't modeled.** Delivery is a constant (`pd.email 0.985`). There are no bounces, spam complaints or sender reputation, and no warmup. Fatigue Guard is the right instinct but only watches unsubscribes. *Change:* add hard and soft bounces and complaints to the funnel. Auto-suppress hard bounces. Show a sender-health line on Analytics (complaint rate against a 0.1% threshold). Let Fatigue Guard trigger on complaint z-score as well.

**5. The headline numbers contradict each other.** On Dec 2, $9.1k of revenue shows "On track, 100% chance" of $230k. On day 1, Nov is "0% chance". Unsubscribes read "0.00% On track" while the subtitle says "Not enough history yet". Winter Layering shows "Likely 166%" while Insight Analyst says it is pacing at 92% and proposes an extension. The "Agent changes, 24h" column shows 0 next to a toast reporting 14 changes. The $230k goal is the same for every month. *Change:* suppress goal probability until 7 days of data exist, and show "Too early" instead of a status pill. Use per-month goals (Nov and Dec differ). Calculate Outlook and Analyst pacing with one selector. Fix the 24h counter.

**6. Holiday dates are broken.** Anchoring display dates to today's date put "Black Friday Early Access" on Dec 12–15 and the Gift Guide after Christmas. Any marketer will notice this immediately. *Change:* anchor display so that the seeded Black Friday lands on the real Black Friday (Nov 27, 2026), or rename seeded campaigns based on the dates they end up with.

**7. Budget control stops at the campaign level.** There is a per-campaign daily cap, but no monthly or quarterly budget by channel, no committed-versus-actual view, and no approval threshold in dollars. Pacer "low risk ≤ 10%" is a percentage, while finance thinks in dollars. *Change:* add a Budget panel on Analytics with a monthly plan by channel, spend, committed spend and remaining budget. Add a guardrail "Agent budget moves over $1,000 always need approval".

**8. The AI fleet plan has gaps on data and transparency.** The plan sends profile and campaign snapshots to a third-party API using a browser-held key, falls back "silently", and gives agents learning from rejections without any visibility. Legal will ask what customer data leaves the system. Ops will ask why an agent behaved differently on Tuesday. *Change:* send only aggregates and no profile-level rows, and state this in the Connect panel. Tag every run as "AI" or "Rules" in Run history, not hidden. Add a per-agent "Reasoning engine: rules only" lock for regulated workflows.

## 3. Quick wins

- Store a dismiss reason and the approver's name on History rows. Show "Expired unreviewed" as a separate status, because 48h expiries currently disappear without notice.
- Show feed items like "on pace for 96%" in neutral text. Red should only mean a real problem.
- Add UTM/link tracking fields to the Content composer, and add a "Copy UTM" button.
- Add a CSV export of the audit/action log. Every SOX or legal request starts with "send me the log".
- Add a sticky "Paused" indicator per channel on campaign cards when Fatigue Guard pauses a channel.

## 4. What NOT to add

- Real ESP/CRM connectors, webhooks or reverse-ETL. Instead, show one static "Integrations" list (Shopify, Salesforce CRM, Meta Ads, Postmark) with synced-at timestamps.
- Multi-touch data-driven attribution or MMM. Last-touch, linear and the holdout lift are enough. Spend the effort on making lift the headline number.
- A full journey canvas editor with drag-and-drop. The template and inspector approach is right.
- Per-field RBAC, SSO or SCIM. Four roles in a persona switcher is enough to prove the governance model.
- More agents. Eight is already more than a 5-person team can supervise. Make the existing ones accountable first.
