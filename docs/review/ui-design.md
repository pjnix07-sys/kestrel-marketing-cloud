# UI design review

Method: screenshots at 1440 and 390, light and dark, of all views, campaign detail, planner and Connect drawer. UXKIN unreachable; comparisons use platform conventions. Contrast not measured numerically.

## Verdict
The Command Center is the one view that looks designed. The sentence headline with underlined live phrases, the revenue line with agent dots, and four unboxed KPIs read like a brief rather than a template, and it works in dark and on mobile. The other views are clean but conventional (bordered panels, tables, tab rows, forms), so quality drops sharply after home. A cold visitor gets the story on home, then lands in ordinary admin UI with no path to the next step.

## Does the signature land?
Mostly. The lede ("on plan with 4 days to go... 6 need you") is clear and the underlined links are honest. Weaknesses: (1) it opens negatively ("Agents haven't changed anything in the last day"), which undersells the product on first view; (2) the journey line has unlabeled dots, with no legend or hover hint visible, so a cold reader cannot tell they are agent actions; (3) the "Needs you" column below the fold on 1440 pushes the point of the page (approve something) away from the headline.

## Findings
1. **High, home, `js/views/home.js` Needs you column:** a bordered proposal card sits inside the bordered panel, breaking §11.2 "no card-in-card". Same pattern: "Waiting for you" on the campaign detail, Suggested by Segment Scout cards on Audiences (`css/views/audiences.css`). Fix: drop the inner border; use a hairline divider between proposals.
2. **High, numerals everywhere:** tabular-nums renders punctuation full-width ("$25 . 3k", "0 . 00%", "Thu , Nov 26 , 7 pm", "1 , 340 people"). It is visible on campaign detail, analytics, audiences, agents ("-$2 , 503"). Source: `font-variant-numeric: tabular-nums` on `.k-kpi-value`, `.k-delta`, `.k-table` and `.num` in `css/app.css:24,460,466,474`, applied to a font whose tnum glyphs space the punctuation. Fix: remove tabular-nums from running text and KPI values, keep it only on right-aligned table columns, or confirm the shipped Schibsted subset has a proper tnum feature.
3. **High, first run:** no guided path (see below). The planner (`#campaigns` > Plan a campaign) opens on a blank form with a disabled primary "Create draft campaign" and a second primary "Draft plan" in the same region, which violates "one primary per region" and leaves the right pane empty.
4. **High, mobile campaign detail:** the variant table clips at the right edge (Conv/send and Chance best columns hidden, no scroll cue), and the tab row cuts off Budget and Activity. Fix: horizontal scroll with an edge fade-free affordance (a visible scrollbar or "More" tab), or stack the table rows.
5. **Medium, §11.4 on Audiences:** the view opens on two near-duplicate agent suggestions ("High-LTV customers" twice, with different thresholds) before the segment list. Lead with the segment list and demote suggestions to one row. Dedupe the proposals.
6. **Medium, campaign detail:** eight agent-change rows with dots on every one (§11.3). Cap at 3 plus "View all".
7. **Medium, Analytics:** four filters precede the chart; collapse to range plus a Filters disclosure.
8. **Medium, Agents:** the header says "8 agents working" and the Reasoning toggle defaults to "Claude" though Claude is not connected, so the state is misleading. Default the selected option to Rules only until connected.
9. **Medium, Campaigns:** header says "3 live" but the board shows Live 2 (paused is likely counted). Scheduled column is an empty column on every load. Fix: count to match, or hide empty columns.
10. **Medium, Connect drawer:** title "Connect Claude" implies a Claude.ai login, but it asks for an API key, which most marketers do not have. Rename "Connect an Anthropic key (optional)"; open with one line on what changes ("Agents write and reason with Claude instead of fixed rules") and put "Type it in instead" as the secondary action. Large empty space below the fold is fine. Mobile top bar shows "Connect Claude" next to a count that is unlabeled (reads as Claude's badge); label it Approvals.
11. **Low, §11 checks:** no gradients, blur, emoji or left stripes found. Segmented controls use ring plus background (double-boxed); keep one.
12. **Low, page-title focus ring:** the h1 shows a boxed outline after every route change (`css/app.css:35`). Looks like a bug on every screenshot; show it only on keyboard navigation, or move focus to `.app-main`.

## Comparison
Command Center vs Stripe and Linear dashboards: those lead with a metric and chart; this leads with a sentence, a stronger idea. Keep the KPIs unboxed. Missing: a legend for agent dots. Connect matches standard key-entry flows but should explain value first and mark itself optional.

## First-run comprehension (cold Pages link)
In 10 seconds a visitor gets: marketing dashboard, November revenue on plan, some agents did things, six items need approval. They do not get: that the data is fake (the banner is small grey text at the top, easy to miss), that the agents are proposing things on their own, what Approve does, or that there is a Claude integration.
A guided first run should be three steps, dismissible: (1) highlight the headline and the dots: "Agents act in the background; each dot is one action"; (2) spotlight one proposal in Needs you with Approve, then show the result in What changed with Undo; (3) point to Agents (autonomy Off/Suggest/Autopilot) and Connect (optional). Pre-select the first approval as the suggested action. Make the sample-data note a one-time banner with "Got it" (already present) and add "Take the 30-second tour" beside it.

## Quick wins
- Fix punctuation spacing (finding 2).
- Remove the inner card border on proposals (1).
- Default Reasoning to Rules only until connected (8).
- Fix the "3 live" count (9).
- Move or label the agent dots on the journey line (legend).
- Rename the Connect drawer (10).
- Hide the h1 outline on mouse navigation (12).
