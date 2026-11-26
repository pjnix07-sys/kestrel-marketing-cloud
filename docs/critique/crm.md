# CRM and Lifecycle critique

## Verdict
This is a promotional-calendar tool with good agent hygiene, not a lifecycle platform. The board shows Draft, Scheduled, Live and Completed with start and end dates, so there is no welcome, abandonment, post-purchase, win-back or VIP program that runs always on. The trust machinery (guardrails, undo, a 10% control) is better than most real products, but it measures agent tweaks, not whether messaging works.

## Assumptions
- Static app, synthetic data, ~6,000 profiles (the Fernway sample). Haiku agents are optional.
- I read the contract and screenshots, not the code. Agents show "0 changes applied", so no track record was visible.

## Top 6 issues, ranked

1. **Campaigns are the only unit; there are no evergreen programs.** "Lapsed Hiker Win-back" is a dated blast (Nov 26 – Dec 21). A real win-back is a trigger: no order for 120 days, enter, exit on purchase, re-entry after a cooldown. *Build:* a "Programs" tab of always-on journeys (Welcome, Browse/Cart abandon, Post-purchase, Win-back, VIP). Each has an entry rule on a segment, an exit rule, a re-entry window, and a daily entered/converted/exited count. Reuse the existing step graph with no end date.

2. **Incrementality is a hidden 10% control, and only agent actions are scored against it.** The holdout is a fixed guardrail, so the marketer sees no "campaign lift vs control" and no confidence interval. The control is re-drawn per campaign (`fnv1a(pid|cid)`), so one customer can be held out of one message and hit by another. *Build:* a persistent universal holdout (e.g. 5%, stable by profile) plus a per-program holdout. Add a Lift card (treated vs control rate, lift, 90% interval, "not enough data yet") on every campaign and program.

3. **Frequency is a per-campaign cap plus a reactive agent.** Guard acts after unsubscribe risk crosses 0.008, which is too late. Nothing shows the whole-customer message load across campaigns, so Black Friday, Holiday Guide and the live win-back can stack on one person. *Build:* a global send ledger (per profile and channel, 7-day count), a "Messages this week" histogram in Audiences, and a pre-launch "collision" warning showing how many people would exceed the cap.

4. **The segment builder is rule-first, with no lifecycle stage, no profile detail and a thin overlap view.** The list shows Avg propensity and Predicted LTV, but "7d change" is a dash and Return is 0.0× or blank. Segments are all "You", so nothing is dynamic versus static. There are no RFM or lifecycle stages (new, active, at-risk, lapsed, VIP). *Build:* a Lifecycle stage attribute (computed from recency and orders) with a stage-transition bar on Audiences. Add a single-profile drawer: timeline of sends, opens and orders, consent per channel, current suppressions, and which programs the person is in. Add "overlap with live audiences" to every segment row.

5. **Predicted scores are shown, but not validated.** Propensity is a logistic model on 8 features, which is plausible. But there is no calibration (predicted vs actual by decile), no lift/gains chart and no "scores refreshed" date. *Build:* a Model health panel with a decile calibration plot, AUC from the holdout label, and score drift. Show the "Why" contributions in the profile drawer too, not only in a popover.

6. **Send-time and Autopilot trust are asserted, not earned.** Send-Time Tuner and Optimizer both default to Autopilot, but a send-time change with ~10% control and small cells is usually noise (Optimizer is guarded by minSample 500). *Build:* a graduated trust ladder per agent: shadow mode (logs what it would do, scored vs a control), then Suggest, then Autopilot after N approved actions with positive realized impact. Show a per-agent scorecard (proposed, approved, undone, realized vs expected $).

## 3 quick wins
- Default Optimizer, Send-Time Tuner and Fatigue Guard to Suggest, and say why on the roster.
- Show holdout size and send-count-this-week on every campaign card.
- Replace the dashes in "7d change" and "Return" with real values or "n/a (not enough data)".

## What NOT to add
- A drag-and-drop journey canvas; a step list with entry and exit rules is enough.
- A bigger agent roster; the eight are enough, the gaps are in measurement.
- Autopilot on budget or audience changes before lift is measured.
