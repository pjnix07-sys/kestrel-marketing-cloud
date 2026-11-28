# Gap review: Campaign & Performance manager (role folder: campaigns)
Verified on the live app (Playwright) and in code. Screenshots: gap/campaigns/{plan,cal,draft,t-Readiness,t-Budget,sched,bf}.png. Repo untouched.

## 1. Day-one jobs
| Job | Can I? | Evidence |
|---|---|---|
| Plan a promo calendar across the next 6 weeks | Partly | Campaigns > Calendar shows bars + peak events (Thanksgiving/BF/Cyber Monday). Read-only: no drag-to-reschedule, no add-from-calendar, no holds/blackouts, no goal overlay. |
| Brief a launch and get a plan | Yes | "Plan a campaign": name, goal (4 types), product, audience (or "let the planner suggest"), budget, dates, channels, tone, offer, notes. Good and quick. |
| Run an offer/promo with a code | No | Offer is a 5-value dropdown (none/free ship/15/25/free gift). No code, no expiry, no stacking rules, no code redemption tracking, no margin check. |
| Launch with confidence | Partly | Strong: Schedule... runs preflight (audience, consent 87%, quiet hours, frequency cap, budget cap, cross-campaign collision "Holiday Gift Guide vs Lapsed Hiker Win-back on Email, Dec 2"). Weak: the 5-item launch checklist is manual ("Mark done", owner dropdown of 5 people), including "Links and UTMs checked" which shows no links or UTMs. |
| Plan/pace paid budget across channels | Partly | Budget tab: per-channel budget/spent, "Next $1 returns $8.89", response curves, Pacer. Good. But only 2 paid channels (Social ads, Web ads); no per-platform (Meta/Google) split, no daily caps, no monthly/quarterly envelope across campaigns. |
| Set up tracking (UTMs, pixels, conversion definitions) | No | grep "utm" in js/: zero product hits. |
| Test (A/B/n) and read winners | Yes (mostly) | Drafts get A/B/C variants; live ones show "which version wins" + holdout lift. Nothing to design a test (hypothesis, split, duration, winner rule); agents just shift traffic. |
| Post-campaign review | Partly | Completed campaigns have "Wrap report", spend pace, lift vs holdout. No learnings carried to the next brief, no "what to do differently", no cross-campaign comparison. |

## 2. Missing sections
- **Channels beyond 5 (blocker for paid roles).** D.CHANNELS = email, sms, push, social, web (js/core/data.js:31). No Search ads, Display/Programmatic, Direct mail, In-app, Marketplace/retail media. "Web ads" conflates on-site banners with paid display. Incumbents: Google/Meta/Direct-mail connectors per channel. Agent-first: agents propose a channel mix with expected return per channel (using the existing response curves), I approve; unsupported channels show "Connect Google Ads" rather than not existing. 
- **Offers & promo codes library (major).** Offers are an enum, not objects. Need: code, discount/threshold, audience eligibility, start/end, usage cap, margin/stock guardrail, redemption and incrementality per offer. Incumbents: Braze/Klaviyo coupon pools, SFMC Promotions. Agent-first: Goal says "clear the tents"; agent proposes the offer (depth, code, expiry) with margin impact and I approve as a decision card; codes auto-created, unique-per-person if wanted.
- **Landing pages (major).** grep "landing": 0 in js; "Web" is only hero content (docs/CONTENT.md:22). Gift Guide email has no destination. Agent-first: agent drafts the page matched to the message, shows preview, wires UTM, A/B tests it.
- **Tracking / UTM and attribution setup (major).** No naming convention, no auto-tagging, no link table, no attribution window/model setting, no view-through vs click distinction. Agent-first: tags are generated and shown read-only in a "Links" table in Readiness; checklist item completes itself when a link check passes.
- **Promo calendar as a planning surface (major).** See job 1; plus no budget-by-month view, no external events beyond 3 retail peaks (no paydays, competitor sales, stock arrivals, shipping cutoffs).

## 3. Gaps inside existing sections
- **Readiness checklist is human busywork (major).** t-Readiness.png: 5 items, each with a 5-person owner picker and "Mark done"; only "Test send" has an action. Against the thesis, agents should tick Legal (rules-based), Consent, Creative approved automatically and ask me only on exceptions. Also "Legal approved" has no legal reviewer path.
- **Conflict handling stops at warning (major).** sched.png shows the collision text ("Stagger the dates or exclude the shared audience") but offers no one-click "stagger by 2 days" / "exclude 559 shared people" fix, and 559 people in both is only a frequency-cap note. Needs agent-proposed resolution.
- **Goals-to-campaigns mapping (major).** Campaign page shows one goal and one number. No view "Goal X needs $Y; campaigns A,B,C cover $Z; gap $W", no overall promo plan against a quarterly target.
- **Budget (major).** Budget is per campaign only. No portfolio pool, no pacing alert vs the calendar (BF page shows "Spend pace 87% Behind plan" while the campaign is already Completed: reading pace on a finished 4-day event is meaningless). Channel "Per day now" and "Next $1" show "–" for owned channels.
- **Testing (minor/major).** No holdout set per campaign (Overview shows holdout lift, but I cannot see/choose the % in the brief; code has holdoutPct:10 fixed, data.js:494). No sample-size/significance statement before winners are declared.
- **Brief form (minor).** Tone list has 4 values, goal types 4, no segment-level offers, no secondary KPI (ROAS, CAC, margin), no creative constraints/attachments, no approval chain.
- **Launch (minor).** Schedule dialog is a single date; no staged rollout (10% first), no timezone send, no "pause all if X" rule on the campaign.

## 4. Confusing / felt fake
- bf.png header: "Goal Hit $48k on Black Friday Early Access" while stats read 86% of goal, $41.3k of $48k. "Hit" reads as achieved: contradictory.
- Completed campaign "Behind plan" spend pace (above).
- Draft "Continue planning" vs "Schedule..." and "Agents never change drafts" is good, but the journey tab shows 0 in step everywhere, so a draft feels empty; no forecast ("expected $24-34k") before launch. A launch needs a predicted outcome.
- Board column "Scheduled 0 / No campaigns scheduled" while Calendar shows nothing planned past Dec 22: the product looks thin for a calendar owner (6 campaigns total).
- Readiness owners are 5 named humans; unclear who the checks belong to if I am a solo marketer.

## 5. Unmistakably agentic and memorable for this role
1. **"Plan my season" goal.** Give a quarterly revenue number; agents lay out the whole promo calendar (dates, channels, offers, budgets, holdouts), show conflicts and what they refused to schedule, and ask me 3 decisions. I move one bar and the rest re-plans.
2. **Self-driving preflight.** Launch day: agents tick the checklist, tag links, test-send, resolve collisions, and present one card: "Ready: expect $27-34k, risk: SMS overlap, fix applied. Launch?" 
3. **Wrap-to-next-brief loop.** Completed campaign auto-writes "what worked", and the next draft opens pre-filled with it ("last time 15% beat 25%, so I'm proposing 15%").

## 6. Top 5
1. Channel coverage: add Search, Display, Direct mail, In-app (with per-platform paid budgets); today only 5 channels exist (data.js:31).
2. Offers/promo codes as real objects with margin guardrails and redemption tracking (currently a 5-value enum).
3. Calendar as the planning surface: editable, goal-vs-plan gap, blackout/holds, agent-built season plan.
4. Agent-run launch readiness with visible links/UTM table and one-click conflict resolution (checklist is manual; conflicts only warn).
5. Landing pages + tracking/attribution setup, and a pre-launch forecast plus post-campaign learnings feeding the next brief.
