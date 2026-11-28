# Marketing Ops / platform admin review (role: ops)

Evidence: live app at #team (Agents, Guardrails tab), settings popover, code (js/core/guardrails.js, js/views/console.js, js/app.js, js/core/catalog.js). Screenshots: gap/ops/guard.png, team.png, settings.png.

## 1. Day-one jobs
1. Connect data sources (store, CRM, CDP, ad accounts, warehouse): NO. Rail has Connect Claude only; the page text contains no Shopify, Salesforce, import, export or webhook anywhere.
2. Define data model and custom attributes/events: NO. Profiles are fixed generated arrays (js/core/data.js); no schema screen.
3. Import/export audiences and data: NO (only a "csv" mention in analytics code, no UI path found).
4. Set who can do what and approval policy: PARTLY. Settings has a "Viewing as" role switcher (5 personas), labelled "Demo". No role editor, no per-action permissions, no invite, no SSO.
5. Set agent autonomy and limits: YES, best part. Per-agent Off/Suggest/Autopilot (catalog agent/setAutonomy), Guardrails tab with freq caps per channel, quiet hours, max change per run, daily spend cap, control group, banned words, reading grade, plus locked "Always on" (consent, drafts, SMS opt-out).
6. Prove compliance (GDPR/CCPA/CAN-SPAM/TCPA): PARTLY. Consent is enforced in code and shown as one locked line; no consent ledger, DSAR/erasure, preference centre, unsubscribe footer/address check, TCPA hours by recipient timezone, or region rules.
7. Set up sending domains and check deliverability: NO. No domain, SPF/DKIM/DMARC, IP warmup, or sender reputation anywhere.
8. Audit what agents did and roll back a mistake: PARTLY. Per-proposal Undo exists (proposal/undo, undoCheck, "Undone" status) and Activity/Run history exist. No filterable, exportable audit log; no bulk rollback or incident view.
9. Control spend and AI usage cost: PARTLY. A daily cap per campaign only. No workspace budget, per-agent/per-goal AI cost, or Claude token usage and billing.

## 2. Missing sections
- **Connections (Data in/out)** [blocker]. Why: nothing real until data flows. Incumbents: Braze/Klaviyo integrations tab, SFMC Contact Builder, CDP connectors, reverse ETL. Agent-first: a Connections page where an agent proposes "I found Shopify and GA4, connect these 2 to answer your goal", checks freshness and mapping, and asks you only for credentials and conflicts. Show health (last sync, row counts, schema drift) per source.
- **Data model** [major]. Custom attributes and events, with identity resolution rules and retention. Agent-first: agent proposes attributes it needs for a goal ("need `last_hike_date`"), you approve the mapping and PII flag.
- **Workspace settings: People and permissions** [blocker]. Real roles, custom role, approval policy (who signs off what, spend thresholds, channel), SSO/SCIM, API keys. Today roles are a demo toggle.
- **Compliance centre** [blocker]. Consent ledger by channel/source/timestamp, suppression lists, DSAR/erasure queue, legal footer/address, regional rules, TCPA. Agent-first: a "Compliance agent" posture: standing report "0 sends violated rules; 2 contacts need review", you approve policy only.
- **Sending setup** [blocker for email/SMS]. Domains, DNS records, warmup, 10DLC/short codes, reputation and bounce/complaint thresholds that auto-pause agents.
- **Audit log + incident handling** [major]. See section 3.
- **Environments/sandbox** [major]. Preview agent changes against a copy of data, or "dry-run goal" before it touches real people. Reset sample data is the only environment concept and it is destructive.
- **Notifications** [minor/major]. Where do approvals, failures and cap breaches go (email/Slack/mobile), quiet delivery, digest.
- **Billing and AI usage** [major]. Plan, contacts, sends, AI cost per goal and per agent, with a hard cap that agents respect.

## 3. Gaps inside existing sections
- **Guardrails tab** (js/views/console.js GuardrailsTab, ~L938): all values are workspace-global. No per-channel/per-audience/per-agent override, no scheduled change, no history of who changed a limit (there is a `updatedBy` conflict chip but no log view). Daily spend cap range is hard-limited 500 to 10000 and "per campaign" only: no weekly/monthly or total workspace cap. [major] Fix: policy page with Scope column, change history, and "simulate this change on last 30 days" before saving.
- **Locked guardrails** are three lines of prose: no way to see evidence (how many sends were blocked by consent this week). [major] Show counts and open the blocked list.
- **No global stop**. Pause exists per agent (autonomy off) but I found no "pause all agents / freeze sends" control on Home, Agents or the rail. For an admin this is the first button during an incident. [blocker] Put a persistent, role-gated "Stop everything" in Agents header; agents report what was in flight.
- **Undo** exists per proposal but sends cannot be unsent; the UI should say which actions are reversible vs not before approval (undoCheck exists in code, check it is surfaced pre-approval). [major]
- **Approvals** (7 pending, mixed with 6 "suggestions") have no policy view: what auto-applies vs waits is only discoverable per agent. [major] One "What needs me" matrix: action type x autonomy x threshold.
- **Run history / Activity**: no export, no API/webhook stream to SIEM or warehouse, no retention statement. [major]
- **Settings popover** (js/app.js SettingsContent): theme, detail, persona, workspace name, reset. One workspace, name not editable, no timezone/currency/locale/fiscal calendar (quiet hours are meaningless without timezone and recipient-timezone handling). [major]
- **Audiences**: no import/upload, no suppression-list management I could find beyond campaign-level suppress action, no sync-out to ad platforms. [major]
- **Connect Claude** (API key): where is the key stored, who can see it, what data is sent to Claude (PII?), is there a redaction setting? Not answered. [major]

## 4. Confusing or untrustworthy
- Agents page subtitle: "Agents follow built-in rules for now. Connect Claude..." reads as the agents are scripted. Honest, but an ops buyer reads it as "not real" (gap/ops/team.png).
- "1 needs your decision, 6 suggestions to review" vs rail badge 7: decision vs suggestion vs approval is three words for one queue.
- Role switcher is labelled "Demo" and changes what you see with no explanation of what each role may do; I cannot inspect the permission set. Feels like theatre for a platform admin.
- Guardrail "Max change per run 20%" and "Minimum sample 500" are unexplained to a non-statistician; no defaults, no "recommended" marker or reset-to-default.
- Sample data only: nothing indicates what is simulated versus would be real after connection, so I can't judge trust in numbers.

## 5. Unmistakably agentic and memorable for ops
1. **Policy by sentence**: type "Never email anyone who bought in the last 3 days; SMS only 9-8 local time; stop if complaint rate > 0.3%". An agent turns it into guardrails, shows the diff, and replays it against the last 30 days ("would have blocked 412 sends") before you save.
2. **Autonomy ladder earned by track record**: each agent shows its record (proposals, undone, blocked) and suggests "Promote to Autopilot for subject-line tests: 40 approved, 0 undone". You accept or refuse; demotion is automatic on an incident.
3. **Incident mode**: when complaint rate, spend or a guardrail breach spikes, agents freeze themselves, an Incident card says what happened, who was affected, and offers one-click rollback of reversible changes with a postmortem agents write.

## 6. Top 5
1. No Connections/Data area: nothing connects to ecommerce, CRM, CDP, ads or warehouse; no schema or import/export.
2. No global "stop all agents" and no incident/rollback surface beyond per-proposal Undo.
3. Permissions are a demo persona switcher: no real roles, approval policy matrix, SSO, API keys, or filterable/exportable audit log.
4. No compliance centre (consent ledger, DSAR, TCPA/CAN-SPAM evidence) and no sending-domain/deliverability setup.
5. Guardrails are global, flat numbers: no scope, history, simulation, workspace-level spend/AI-cost budgets, or billing/usage view.
