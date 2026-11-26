# Campaign manager's critique: Campaigns, Command Center, Analytics

Assumptions: reviewed at the app's "today" (Thu Nov 26, 01:00, Thanksgiving) on sample data; Planner judged from the spec and the empty brief form (the plan needs a name before it drafts).

## Verdict
The shell is credible: board, calendar with BFCM markers, per-campaign budget and outlook, agent changes attributed in plain English. But it models a campaign as a bundle of channel budgets with a forecast, not as a launch with owners, dates, dependencies and a go/no-go. At the moment that matters most (Thanksgiving morning, hours before Black Friday) the product shows an empty "Needs you", a calendar that disagrees with the board, and nothing telling me what must ship today.

## Top 6 issues, ranked

1. **The peak-event calendar is wrong and passive.** Black Friday Early Access is dated Dec 13–16 on the board, yet its calendar bar sits around Nov 27–30. "Early access" after Cyber Monday is nonsense, and the two views contradict each other.
   Build: derive the board, list and calendar from one date source, and add a "Peak plan" lane (Thanksgiving, Black Friday, Cyber Monday, Giving Tuesday, shipping cutoffs) with a warning when two campaigns hit the same segment and channel on the same day.

2. **No launch checklist or QA stage.** Draft, Scheduled, Live, Completed skips build, QA, approval and launch. "Schedule requires preflight with no fail" covers guardrails only. There are no seed or test sends, link and UTM checks, promo-code loaded, inventory or landing-page ready, legal sign-off, or SMS quiet-hours check.
   Build: a per-campaign Readiness tab with owner, due date and status for about 10 fixed items (copy approved, creative received, UTMs, code live, test send, suppression list, consent check). Block Schedule until required items are green.

3. **Goals and pacing don't survive contact with a real flight.** Home says "Off track" at $94k of $230k with 0% chance, while the contract says $140k. Both live campaigns show "Too early" and $0 at 01:00. There is no daily pacing target, no budget burn against days left, and no peak-day weighting, so BFCM looks the same as a Tuesday. Pacing is a single Spend/Budget bar.
   Build: a pacing curve per campaign, with a planned day-by-day spend and revenue line that can be shaped (front-load Fri, Mon), actual drawn over it, and a "behind by $X, recover with Y" line. Set the month goal consistently from one place.

4. **The agents' day is invisible on a cold open.** Eight agents show "first run pending" and Needs you is 0. A manager's morning check is: what happened overnight, what needs approval before 9am, what's at risk today. The home page gives a generic feed.
   Build: a "Morning brief" block at the top of Home: overnight changes, three approvals with a deadline ("before the 9:00 email"), and today's sends by hour. Give each proposal a decide-by time and a one-line cost of waiting.

5. **Budget what-if is buried and can't reflect constraints.** It sits in the last Analytics tab, with per-channel sliders but no floors, caps, commitments (paid social is usually booked daily) or total ceiling. "Apply to campaign" has no approver.
   Build: put what-if on the campaign Budget tab. Add locked channels, a total cap, and a diff view ("+$1.2k social, -$1.2k push") that goes to approval when above a threshold.

6. **No handoffs, no wrap.** Nothing assigns work to content, CRM, design or ops, and nothing closes a campaign. There is no wrap report with goal vs actual, learnings, channel ROAS, holdout lift, and carry-forward audiences or tests.
   Build: owners and due dates on readiness items (notify only, no integrations), and an auto-generated one-page wrap on End campaign that can be exported.

## Quick wins
- Rename the unlabeled calendar bar and fix the date mismatch (issue 1).
- Replace "Too early" with the expected-by-now figure ("$1.1k planned by 09:00").
- Add the hour of the next scheduled send to each Live card.

## What NOT to add
- More agents or autonomy toggles. Eight is already more than a manager can supervise.
- Drag-and-drop calendar editing or a project-management clone.
- Generative plan narratives before the dates, pacing and checklist are right.
