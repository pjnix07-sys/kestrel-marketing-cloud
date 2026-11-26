# Copy review (UX copy + Fernway brand)

**Verdict.** The interface voice is mostly good: sentence case, plain verbs, honest errors ("Couldn't reach Anthropic. Check your connection and try again."), and no tick/seed/simulation/digest leaks in user-visible text ("seed list" in campaigns.js:571 is a real email term). The weak spots are number and time formatting that changes within one card, a few log-like agent lines and raw template tokens in sample copy, and one noun ("proposal") that leaks into errors while the UI says "change" and "suggestion". Fernway's brand book is solid, but the seeded urgent variants and one preheader break its own rules.

Assumptions: I read rendered text for all six routes at port 8866, plus source greps. Query-string routes (`#agents?tab=...`) didn't switch tabs, so I read those tabs from source only.

## Findings, ranked

1. **High: money and time formats change mid-card.** The same Analyst insight shows "About $26,578 of $38,000" while the Campaign pacing card says "$10.2k short" and Home says "$158k". Times appear as "7 pm", "1 pm", "Nov 26 · 19:00" and "Wed, Nov 25". Fix: in agents/analyst.js (`gf`/`money`), use compact form ($26.6k of $38k) above $10k and exact below it. Use 12-hour times everywhere (console.js `stamp`).
2. **High: raw tokens in library cards.** Content shows "{first_name|}, the cold is calling" and "{first_name|}, thanks for exploring with us". An empty-fallback token should render as no name. Fix: either render the token with the same function as previews, or drop the "{first_name}, " lead in the subject bank (copy.js:60-71).
3. **High: log-like and contradictory agent lines.**
   - Home says "Agents haven't changed anything in the last day" while the feed below lists "Variant Optimizer applied" from yesterday.
   - "Budget Pacer suggests: Move..." repeats the agent name that sits in the row beside it.
   - "(−$7–$322)" and "(0.2 pp–0.2 pp)" print a degenerate range.
   - "under a 5% chance of hitting it" reads oddly.
4. **Medium: duplicate Scout suggestions.** "High-LTV customers" appears twice with near-identical titles, and the second one has no definition. Titles must carry the rule (copy "that" ≥ $280 into the title).
5. **Medium: "proposal" leaks.** catalog.js:1529 and :1613 say "This proposal is no longer pending", but the UI says "change" or "suggestion". Also "Pick a reason." (catalog.js:1616) doesn't say where.
6. **Medium: one action, several names.** The card button is "Approve" (agent-ui.js:394), the status is "Approved and applied" or "Applied", the filter is "Approved", and the toast is "applied". Pick approve (user) and applied (state), then use them consistently. Likewise "Needs you" (tab, status chip) vs "waiting for you" vs "suggestions" vs "Approvals". Use "Needs you" for the list and "waiting" only in counts.
7. **Medium: apostrophe style is mixed.** Straight in "You're exploring", curly in "haven’t" and "can’t". Pick curly everywhere, or straight everywhere, in a single pass.
8. **Medium: brand-book violations in seeded variants.**
   - copy.js:76 "Free returns within 60 days on every order." is approved by claim `returns-60`, but "on every order" adds scope beyond the source.
   - copy.js:87 and :101 ("The clock is ticking", "Time is running out", "Time is almost up") are manufactured urgency. The brand pairs say "Deadlines match the campaign dates".
   - copy.js:100 "Once it ends, it ends." is filler.
   - The urgent SMS "Fernway: Your pick is waiting" has no deadline.
9. **Low: Connect panel.** Good overall. "Haiku 5.5" in the status line is model jargon for marketers, and "Connect Claude to let the agents reason and write" could be "Connect Claude so agents can explain their decisions and write copy."
10. **Low: status chips.** "Too early" (campaigns.js:220) is cryptic. Use "Too early to tell", as analyst.js:191 does.

## Find/replace table (top 40)

| # | file:line | Current | Proposed |
|---|---|---|---|
| 1 | views/home.js:359 | Agents haven’t changed anything in the last day, but 6 need you. | Agents haven't made changes since yesterday, but 6 need you. (and compute from the same window as the feed) |
| 2 | core/runtime.js:598 | `name + ' suggests: ' + title` | title only (agent is already shown) |
| 3 | core/runtime.js:598 | `name + ' applied: ' + title` | `name + ' applied ' + title.lowerFirst` ("Variant Optimizer shifted 12% of email traffic...") |
| 4 | core/runtime.js:600 | Segment Scout has 2 suggestions waiting for you | Segment Scout has 2 suggestions for you |
| 5 | agents/analyst.js:24 | under a 5% chance | a chance below 5% |
| 6 | agents/analyst.js:205 | X is on pace for 70% of its revenue goal | X is heading for 70% of its revenue goal |
| 7 | agents/analyst.js:225 | It is on pace for | The campaign is heading for |
| 8 | agents/analyst.js (gf) | $26,578 of $38,000 | $26.6k of $38k |
| 9 | ui/agent-ui.js (impact range) | (0.2 pp–0.2 pp) | omit range when lo = hi; else "(0.1 to 0.4 pp)" |
| 10 | ui/agent-ui.js (impact range) | (−$7–$322) | (−$7 to +$322) |
| 11 | ui/agent-ui.js:398 | Expires in 37h | Expires in 1 day (over 24h); "in 5h" under 24h |
| 12 | core/catalog.js:1529 | This proposal is no longer pending. | Someone already decided on this change. |
| 13 | core/catalog.js:1613 | This proposal is no longer pending. | Someone already decided on this change. |
| 14 | core/catalog.js:1616 | Pick a reason. | Choose why you're dismissing this. |
| 15 | core/catalog.js:1587 | Approve several | Approve selected |
| 16 | ui/agent-ui.js:327 | No longer applies: the campaign changed since this was proposed. | Out of date: the campaign changed after this was suggested. |
| 17 | app.js:424 | Couldn't approve these changes. | Couldn't approve these changes. Reload and try again. |
| 18 | ui/agent-ui.js:366 | Couldn't approve this change. | Couldn't approve this change. Reload and try again. |
| 19 | app.js:589 | Something went wrong while loading the sample data: | The sample data didn't load. Reload the page; if it keeps happening, check the console for: |
| 20 | core/engine.js:71 | Live updates stopped after a problem. Your work is safe; reload the page to start fresh. | Live updates stopped. Your changes are saved. Reload to resume. |
| 21 | ui/kit.js:920 | Couldn't undo: the change no longer applies. | Couldn't undo. Something else changed this since. Review it, then edit by hand. |
| 22 | views/campaigns.js:220 | Too early | Too early to tell |
| 23 | views/campaigns.js:456 | Nothing here right now. | No campaigns scheduled. |
| 24 | views/console.js:264, :571 | Hasn't run yet | Not run yet |
| 25 | views/console.js:734 | Not loaded yet | Not available yet |
| 26 | views/console.js:528 | Applies once Claude is connected. Until then this agent uses its built-in rules. | Connect Claude to turn this on. Until then the agent follows its built-in rules. |
| 27 | views/console.js:1102 | nothing waiting for you | nothing needs you |
| 28 | views/audiences.js:794 | Copy into builder | Edit in builder |
| 29 | views/analytics.js:1211 | Plain-language readouts of the numbers below, refreshed as results come in. | What changed in your numbers, in plain words. |
| 30 | views/analytics.js:404 | Show agent actions | Show agent changes |
| 31 | views/connect.js:101 | Connect Claude to let the agents reason and write. It uses your own Anthropic key. | Connect Claude so agents can explain their choices and write copy. You use your own Anthropic key. |
| 32 | ai/client.js:22 | Haiku 5.5 | Claude (hide model id in the panel) |
| 33 | core/copy.js:76 | Free returns within 60 days on every order. | Free returns within 60 days. |
| 34 | core/copy.js:87 | The clock is ticking | Ends {date} (needs the campaign end date) |
| 35 | core/copy.js:87 | Time is running out | Last day: {date} |
| 36 | core/copy.js:100 | Once it ends, it ends. | The offer ends {date}. |
| 37 | core/copy.js:101 | Time is running out. {OS} Grab {THEP} before the offer ends. | {OS} The offer ends {date}. |
| 38 | core/copy.js:60-71 | {first_name}, {PL} is calling (empty token shows as "{first_name\|}") | render token with fallback; never show braces in the Library |
| 39 | agents/guard.js:99 | Rest 117 people from SMS on Black Friday Early Access for 3 days | Pause SMS to 117 over-messaged people on Black Friday Early Access for 3 days |
| 40 | agents/pacer.js:69 | Web ads on X is overspending: 39% above plan | Web ads on X are spending 39% above plan |

## Quick wins

- Standardize money to $26.6k/$38k above 10k, with a single `MC.fmt.moneyShort` call.
- Standardize time to "7 pm" and drop "19:00" (console.js `stamp`).
- Fix rows 2, 3, 12, 13 and 22 (one-line string swaps).
- De-duplicate the Scout "High-LTV customers" titles.
- Remove "on every order" and the three clock-ticking urgent lines from the seeded bank.
