# Gap review: CMO + first-time coordinator (cmo-beginner)
Method: Playwright against the local checkout (file://), desktop 1440 and phone 390. Screenshots in /tmp/claude-0/-home-user-kestrel-marketing-cloud/cbde7910-1a47-5716-97f6-c1d6bcbc808a/scratchpad/gap/cmo-beginner/ (home.png, goal.png, newgoal.png, goal_new.png, agents.png, guardrails.png, m_home.png, results.png).

## 1. Day-one jobs
1. (CMO) Ten-second read of what agents are doing and why: PARTLY. Home hero "$59.8k from your goals so far, 7 decisions waiting" is good. But the first screen is a decision queue plus a $181k revenue chart with "Goal $222k" that matches no goal shown; "Recent agent work" is all about a finished goal.
2. (Beginner) Set a first goal: PARTLY. Drawer is one box, good. Result is wrong (see 3a).
3. (CMO) Set quarterly goals and split budget across them: NO. No budget per goal, no pool, no quarter view.
4. (CMO) Know what agents may do alone, cap spend, undo: PARTLY. Agents > Guardrails has daily spend cap, quiet hours, banned words, always-on rules; per-agent Suggest/Autopilot exists (js/ui/agent-ui.js AutonomyControl); proposals have Undo. Nothing tells a first-time user the default posture, or ties it to a goal.
5. (CMO) Executive report for the board: NO. Results has goals, revenue, channels, but no shareable/exportable summary, no period compare (QoQ), no "what agents did for the money".
6. (Beginner) Find help: PARTLY. Help is a 3-line popover: Getting started, Set a new goal, 3 shortcuts. No glossary, no "what is a segment/holdout", no contact/support.
7. (Beginner) Set up my own workspace instead of Fernway: NO. Settings shows "Fernway Outfitters / Sample workspace" and only Reset. connect.js only takes a Claude API key.
8. (Both) Use on a phone: YES. Bottom bar, no horizontal overflow (scrollWidth 390), decisions usable (m_home.png).

## 2. Missing sections
- **Workspace setup / data connections (blocker, CMO + beginner).** No way to connect a store, CRM/customer file, ESP/SMS sender, ad accounts, consent source, or sending domain. Incumbents: connector wizards plus data-health pages. Agent-first: "Tell me your site and I will find your catalog, brand colours and voice; upload customers; I propose a plan to verify". Agents (Scout, Copy) do it, you confirm access and consent in one card. Without this the product cannot be bought; the brand name is hardcoded (js/views/mission.js:491 falls back to 'Fernway Outfitters').
- **Brand kit and voice (blocker for CMO).** Only banned words, subject length and reading grade in Guardrails. No tone, claims library, approved offers, legal footers, logo/colours, "never say" per product line. Agent-first: Copy Drafter proposes a voice summary from your site and past emails; you edit and approve; every draft is scored against it with the score visible on Approvals.
- **Budget and planning (major, CMO).** Spend exists per campaign (Campaigns > Budget tab) and a what-if tool buried in Results > Advanced. No monthly/quarterly pool, no goal-level budget, no "move $5k from Win-back to Launch". Agent-first: Planner proposes an allocation across goals with expected return and ranges; you approve; Budget Pacer works inside each envelope and asks before breaching.
- **Team, roles, audit (major, CMO).** Persona switcher is labelled "Demo: switch roles". No real users, invitations, approval thresholds (e.g. spend over $X needs CFO) or exportable audit log.

## 3. Missing or broken inside existing sections
a. **Goal interpretation is silently wrong (blocker, CMO).** I typed "Grow revenue as much as you can this quarter, spend whatever it takes". It became "add 200 new sign-ups by Dec 19", Limits "None set", then asked "How many sign-ups is the target?" (goal_new.png). It changed my metric, ignored "whatever it takes", and never asked for a budget ceiling. A CMO would not trust this with money. Fix: echo understanding ("Goal: revenue; deadline Dec 31; budget ceiling: not set. Set one?") before planning; require a spend ceiling; refuse unbounded spend language.
b. **No budget in the New goal flow (major, both).** Drawer has only a text box. Beginner has no idea they can state a budget or channels; the example hints at discount limits only.
c. **Trust gap on autonomy (major, CMO).** Approvals tag "Needs you: Always reviewed" and "low/medium risk", but there is no plain statement of the default ("Agents never send without your approval until you turn on Autopilot for X"). Autopilot lives on each agent's settings page (js/views/console.js ~557), not on Home or the goal. Add a "What agents may do without asking" strip on goal page: sends, spend up to $X, copy, audiences, with a toggle each.
d. **Inconsistent verdicts (major, CMO).** Home labels Black Friday goal "Done" in green-neutral while saying "$6.7k short"; Results labels the same goal "Missed". Pick one ("Missed by $6.7k"). Same goal, "Hit $48k" vs "Hit $48k on Black Friday Early Access" fine, but status words must match.
e. **Numbers that do not tie (major, CMO).** Home hero $59.8k vs Home chart "Goal $222k / $181k" vs Results "$189k complete days". Chart goal $222k has no owner. Goal page says "671 people ... 1,632 messages ... $18,493 back against $4,013 spent" for a goal measured in win-backs (63 of 400); the dollar figure sits beside a count target without a bridge, and "743 is enough" appears next to 671 audience. Results channels: "SMS returns 173.6x on $20 of spend" reads as fake; show a floor ("too little spend to rank").
f. **Unrendered copy (minor, beginner).** Goal page message preview: "Hi first name, it has been a while." (merge token shown as plain words). Journey shows "1 days".
g. **Empty states (major, beginner).** I could not reach a true empty workspace. Reset restores the sample. A new goal page shows "Not made yet / nothing spent yet" tiles, fine, but Home/Campaigns/Audiences/Results with zero data are unverifiable and untested; the onboarding promise depends on them.
h. **Getting started is not discoverable (minor, beginner).** Tour is suppressed under webdriver and for deep links; inside Help it is one unlabelled item with no progress or checklist (PRODUCT.md promised "3 to 5 real tasks, dismissible"). Not a checklist in the product today.
i. **Rail tooltips only (minor, beginner).** Icon-only rail hides section names; "Agents" icon (node graph) and "Audiences" (people) are not self-evident on first run. Tooltip shows on focus, good for keyboard; touch users on desktop-width tablets get nothing.
j. **Executive reporting (major, CMO).** Results page sentence is good ("1 is behind pace and 1 ended short") but there is no "Share / export / schedule weekly summary to my inbox", no QoQ, no cost per goal.

## 4. Confusing or felt untrustworthy
- "Goals / Forecast / Behind pace: 78 of 400 (73 to 83)" is clear and honest; the range is a strong trust signal. Positive.
- Terminology: "Steer", "Segment", "Wave 1", "holdout"/"control group", "lift", "cadence" appear without glosses on Guardrails ("Minimum sample", "Max change per run", "Control group"). Beginner cannot know safe values (goal.png, guardrails.png).
- Decision card "If approved: 24 to 45 win-backs" with two buttons is the best moment in the product; but "Leave the end date" does not say the goal is then likely missed.
- Home "Recent agent work" starts with the closed goal's old events, so the live goal's agents are not visible at the top. Fails the ten-second test for "what are they doing now".
- Banner under Agents: "Agents follow built-in rules for now. Connect Claude so they can explain their choices and write copy." A CMO reads this as "the AI is not on yet": it undermines the thesis.
- "Viewing as ... Demo: switch roles" in Settings reads as a prototype.

## 5. Unmistakably agentic and memorable (for my role)
1. **Brief-back before spend.** Planner restates the goal, the budget envelope, the channels it will and will not touch, and the worst case, with one "Go" button. Every goal carries a "Can lose at most $X" line.
2. **Weekly CMO brief written by the agents**, one page: what moved, what each agent did, what it cost, what it wants from you; sendable to the board with one click.
3. **Onboarding by interview**: paste your site and a customer file; agents return a brand voice, three candidate goals with budgets, and a first week plan. You accept or edit.

## 6. Top 5, ranked
1. Goal intake rewrites the goal wrongly and sets no spend ceiling (New goal drawer, goal_new.png): add brief-back and required budget limit.
2. No workspace setup or data connection and a hardcoded Fernway brand: cannot onboard a real company.
3. No budget/quarter model across goals; budget only per campaign and a buried what-if tool.
4. Autonomy and brand rules are not legible or visible where decisions happen; no brand kit; default posture unstated.
5. Numbers/status inconsistencies and no executive export (Done vs Missed, $59.8k vs $222k vs $189k, "173.6x on $20", "Hi first name").
