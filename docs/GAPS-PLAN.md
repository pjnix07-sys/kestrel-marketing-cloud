# Gap review and plan to close it (Nov 28)

Six reviewers, each in role, used the live app and read the code: Lifecycle/CRM manager, Content & brand lead,
Campaign & performance manager, Marketing ops admin, Analytics lead, and a CMO paired with a first-time coordinator.
Full reports: docs/review/gaps/*.md (screenshot paths in them point to the review session scratchpad).

Thesis check for this plan: every gap is closed agent-first (an agent does the work and brings you one decision), on
the existing rail, simple by default with depth in Details. Incumbents are the checklist only.

## What the team liked (keep)
- The decision card ("If approved: 24 to 45 win-backs", two buttons, no countdown) is the best moment in the product.
- Honest forecast ranges ("Behind pace: 78 of 400 (73 to 83)"), the universal holdout, content intelligence.
- Phone layout works: no overflow, bottom bar usable.

## The verdict in one paragraph
The agentic loop works for two seeded goals, but a real team could not run its marketing here yet. Three things
block a purchase: (1) **trust**: numbers and statuses disagree between screens and goal intake can silently rewrite
a goal with no spend ceiling; (2) **foundation**: no workspace setup, data connections, people/permissions,
compliance or sending setup, so nothing real can flow in or out; (3) **depth in each job**: lifecycle has no event
triggers or programs library, campaigns have no offers/landing pages/UTMs or plan across goals, content cannot be
created from scratch and has no brand book or review workflow, analytics has no experiments, reports or
incremental view.

## Decisions for you before building
1. **Real vs sample connections.** A static GitHub Pages app cannot really connect Shopify, an ESP or ad accounts.
   Recommended: build every setup surface for real (Connections, People, Compliance, Sending, Brand kit) running on
   the sample workspace, with sources shown as connected sample sources and a working **empty-workspace path** that
   accepts a customer CSV and a website URL in the browser. Claude stays the only live external connection.
2. **Where new areas live (rail stays minimal).** Recommended: Settings becomes a full page (gear → `#settings`)
   with sections; Goals gets a **Plan** tab (quarter, budget across goals, calendar); Campaigns gets **Always-on**
   (programs) and **Offers**; Content gets **Brand** and **Assets**; Results gets **Experiments** and **Reports**.
   No new rail icons.
3. **Order.** Recommended: Phase 0 and 1 first (trust and control, about a week of work), then 2 to 6.

## Phase 0: trust fixes (bugs every reviewer hit) — blocker
| # | Fix | Where |
|---|---|---|
| 0.1 | One status per goal everywhere: Black Friday reads "Done" (Home), "Missed" (Results), "$32.2k (67%)" (Home feed), header "Goal Hit $48k" (campaign). Use `MC.metrics.mission` band and text on every surface and in agent beats. | home.js statusOf, campaigns.js header, missions.js final beat |
| 0.2 | Finished campaigns show no "spend pace / behind plan"; past-date insights ("heading for 90% by Fri Nov 27" on Nov 28) say ended. | campaigns.js, insights |
| 0.3 | Channel ROAS: suppress ranking below a spend and sample floor ("too little spend to rank"), show cost basis; table or log scale instead of a 0 to 180x bar axis. | analytics.js channels |
| 0.4 | Agent impact rows showing "$0, $0 to $0": show "measuring" until there is data. | analytics.js agent impact |
| 0.5 | Copy leaks: "Hi first name" (render tokens with sample values in previews), "1 days", truncated angle labels. | mission.js previews, journey, DotInterval labels |
| 0.6 | Home revenue chart "Goal $222k" has no owner: label it as the monthly plan or remove; Home "Recent agent work" leads with live goals. | home.js |
| 0.7 | One vocabulary for the queue: "decisions" (asks) and "suggestions" (proposals) both under Approvals; counts match. | app.js, console.js |
| 0.8 | Remove "Agents follow built-in rules for now…" banner; say "Running on rules; connect Claude for written explanations" only in Settings. Drop "Demo:" from the role switcher. | console.js, app.js |
| 0.9 | Scheduled promos (Black Friday) are expected events, not anomalies; anomalies offer "Why did this move?" (Phase 6) and "Expected". | analytics.js anomalies |
| 0.10 | Reconcile attributed vs incremental: Results says plainly where credited revenue and holdout lift disagree (Winter Layering credited $34.9k but −42% vs held out). | analytics.js, metrics.js |

## Phase 1: goal intake and control — blocker (CMO, ops)
- **Brief-back before anything runs.** New goal → Planner restates metric, target, deadline, audience, channels it
  will and won't use, **budget ceiling** and worst case; one "Start" button, edit inline. Unparseable or unbounded
  ("spend whatever it takes") becomes a question, never a silent rewrite ("Grow revenue…" became "200 sign-ups").
  New goal box gets optional Budget and Channels fields with examples.
- **"What agents may do without asking" per goal**: sends, spend up to $X, new copy, new audiences, each a toggle with
  the default stated; workspace default shown on first run. Replaces hunting through each agent's settings.
- **Stop everything**: role-gated control in Agents and Settings; freezes sends and agent actions, lists what was in
  flight, one Resume. Logged action.
- **Reversible vs not** shown on every decision and suggestion before approval (from `undoCheck`).
Acceptance: e2e for brief-back on 6 goal phrasings incl. unbounded spend; stop/resume replays exactly.

## Phase 2: workspace foundation — blocker (ops, CMO, lifecycle)
Settings page sections, each with an agent that does the setup and brings you one decision:
- **Workspace setup by interview** (memorable): paste a site URL and upload a customer CSV; agents return brand
  name, colours, voice summary, catalogue categories, three candidate goals with budgets and a first-week plan. A true
  empty workspace exists (not only "Reset sample") with empty states on every page.
- **Connections and data**: sources (store, CRM/customer file, web events, ESP/SMS, ad accounts, warehouse) with last
  sync, rows, freshness and schema drift; **events** (signup, view, add_to_cart, order) and **attributes** with PII
  flags; identity rules (email/phone merge); import/export. Agent proposes "found a cart event with no flow using it".
- **People and permissions**: real roles, approval policy matrix (action × channel × spend threshold → who approves),
  invitations; filterable, exportable **audit log**.
- **Compliance and sending**: consent ledger (channel, source, timestamp, history), suppression lists, DSAR queue,
  legal footer/address, regional rules (GDPR, CCPA, CAN-SPAM, TCPA), **preference center** with topics and frequency,
  one-click unsubscribe, SMS STOP/HELP; sending domains (SPF/DKIM/DMARC status), warm-up plan, bounce/complaint
  thresholds that auto-pause agents. **Transactional vs promotional** message class (bypasses promo caps, never
  agent-edited for offers).
- **Measurement settings**: attribution model and window, click vs view, holdout %, significance, timezone, currency,
  fiscal calendar.
- **Usage and billing**: contacts, sends, Claude cost per goal and per agent, hard cap agents respect.
- **Notifications**: where decisions, failures and cap breaches go; daily digest.

## Phase 3: lifecycle — blocker for CRM
- **Always-on programs** (Campaigns → Always-on): library of welcome, abandoned cart/browse, post-purchase,
  replenishment, birthday, VIP, win-back; each with event trigger, entry/exit/re-entry as fields with audience preview,
  priority when a person qualifies for two, per-program cap and holdout, health. **Lifecycle coverage map**
  (memorable): moments with no flow, and the agent drafts the missing one as a decision.
- **Journey editor**: add/remove/reorder steps; random split, multi-way branch, wait-until-event and time-of-day,
  update-profile/tag/webhook steps; conversion and drop-off per step; time in step; why people exited. Agent changes
  arrive as a journey diff you approve.
- **Caps and quiet hours**: cross-channel daily cap, lifecycle vs marketing split, per-journey override, recipient time
  zone.
- **Segmentation depth**: behavioural, time-windowed conditions (did X in last N days), nested AND/OR, journey-based
  segments, exclusion lists, static vs dynamic, CSV import.

## Phase 4: plan and campaigns — major (campaigns, CMO)
- **Goals → Plan tab**: quarter view of goals with targets, budget envelope per goal and a pool; "Goal X needs $Y,
  campaigns cover $Z, gap $W"; Planner proposes allocation across goals with expected return and ranges; editable
  calendar (drag, holds, blackouts, shipping cutoffs, paydays).
- **Offers and codes** (Campaigns → Offers): offer objects (discount, threshold, eligibility, dates, usage cap, margin
  and stock guardrail), unique codes, redemption and incrementality per offer; agent proposes offer depth with margin
  impact as a decision.
- **Landing pages and links**: agent drafts a page matched to the message, preview, A/B; links table with auto UTMs;
  the readiness item completes itself when the link check passes.
- **Channels**: add search, display, in-app and direct mail (unconnected ones show "Connect" in Settings), per-platform
  paid budgets.
- **Readiness checklist run by agents**: legal (claims rules), consent, creative approved, links, test send tick
  themselves; you see only exceptions. **Conflicts** get one-click fixes ("stagger 2 days", "exclude 559 shared
  people").
- **Draft forecast** ("expected $24k to 34k") before launch; staged rollout (10% first); **post-campaign review**
  written by Insight Analyst that feeds the next brief.

## Phase 5: content — major (content lead)
- **Create from scratch**: new message, new block, upload image; Compose works for new items (dispatches
  `message/create`).
- **Brand book** (Content → Brand): voice pillars, do/don't pairs, preferred/banned terms, approved claims with source,
  owner and expiry, mandatory disclaimers; drafted by the agent from the site and best copy ("Is this how you sound?");
  every draft shows its brand score and the rule that failed. Surfaces the existing `CP.VOICE` and `DEFAULT_CLAIMS`.
- **Review workflow**: one queue (Approvals), reviewer and legal roles, comments, version diff and restore; seeded
  history includes real reviews; signature blocks exempt from fatigue.
- **Assets**: upload, tags, rights and expiry, editable alt text, focal point; agent auto-tags and flags missing alt
  text.
- **Templates and layouts**: email layout, header/footer, landing-page templates, brand-locked modules.
- **Personalisation and localisation**: token picker with fallbacks, dynamic content rules per audience, persona
  preview and test send; locales with translation and reviewer flags.
- "Passes every check" expands to the list of checks and sources.

## Phase 6: measurement — major (analytics, CMO)
- **Experiments** (Results → Experiments): ask a question in a sentence; the agent writes the test card (hypothesis,
  split, sample needed, days to power, guardrail metric), runs it and ends with one decision card. Holdout auto-grows
  when intervals are uninformative. Replaces the 90/5/5 "chance best" readout.
- **Reports** (Results → Reports): saved views, custom date range, period compare, CSV/PDF/link export, and the
  **Monday CMO brief** (memorable): agents write a one-page summary of what moved, what each agent did, what it cost,
  what it needs from you; schedule and send.
- **Why did this move?** on any number or spike: causal decomposition (send, audience mix, channel, holiday,
  tracking) with confidence, or "can't tell".
- **Cohorts, retention and LTV** by acquisition goal; site/app funnel once events exist (Phase 2).
- **Data health** panel: sources feeding each number, freshness, lag.

## How we will build it
Same harness as before: the lead prototypes each new surface on real state and looks at it first; Sonnet workers
build lanes with strict file ownership; every phase ends with e2e, smoke (identical twice), missions, metrics,
content, affinity, agent-eval and a live check with screenshots.

| Phase | Lanes (parallel) | Size |
|---|---|---|
| 0 Trust fixes | metrics/analytics · home/goals · campaigns/content copy | S |
| 1 Intake and control | planner/brief-back · autonomy policy + stop · decision reversibility | M |
| 2 Foundation | settings shell + setup interview · connections/data/events · people/audit · compliance/sending/preferences | L |
| 3 Lifecycle | programs + coverage map · journey editor · caps/quiet hours/segmentation | L |
| 4 Plan and campaigns | Plan tab + budget allocation · offers/codes · landing pages/links/channels · readiness/conflicts/forecast | L |
| 5 Content | create + assets · brand book + scoring · review workflow + versions · templates/personalisation/locales | L |
| 6 Measurement | experiments · reports + CMO brief · why-did-this-move + cohorts + data health | L |

Every new world object (offer, program, event, connection, consent record, experiment, report) is a logged catalog
action with deterministic replay, read through `MC.metrics`/selectors, and visible through `MC.ui.Xref` links.
