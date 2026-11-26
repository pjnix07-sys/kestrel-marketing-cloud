# Design critique: Kestrel Marketing Cloud

Assumptions: light and dark were both reviewed; "Fernway" data is a fresh sample session, so empty states are real states; CONTRACT §11 is the bar; viewport screenshots cap at 900px height, so the sidebar ending mid-page in full-page shots is a capture artifact, not a bug.

## Verdict
The craft is clean and restrained: tokens are coherent, §11 is largely honored, and the slate-and-russet palette avoids the cream/terracotta cliche. But it reads as a competent generic SaaS dashboard: white bordered boxes everywhere, one radius, no signature moment, and the agentic idea (the whole product) is the weakest-drawn thing on the Command Center. One real left-stripe violation remains, and several small defects (clipped theme switch, clipped table on phone, empty hero states) undermine "award-quality".

## Top 10 issues, ranked
1. **Home hero is empty and spends its prime space on nothing.** "What changed" (the agentic story) shows "Nothing yet" while 7 agents sit idle with "first run pending", and the forecast chart takes the biggest slot. Fix: lead with What changed full width above the forecast; seed 3 to 4 real feed rows at boot; collapse empty "Needs you" to a single line in the header. `js/views/home.js`, `css/views/home.css`.
2. **Home layout leaves dead holes.** Right column under "Needs you" and left under "What changed" are blank (1440, y 620-900 and 1050-1540). Fix: single column feed + narrow right rail, or masonry-free grid rows with `align-items: start` removed and Agents panel shortened to a compact dot row list. `.v-home` grid.
3. **Agents roster list on home is eight identical rows** repeating "first run pending". Fix: show only agents that acted or need you; link to Agents for the rest. `js/views/home.js`.
4. **Everything is the same white bordered box.** Cards on every route share one radius/border/weight; hierarchy comes only from titles. Fix: drop borders on Campaigns board cards and home panels (use `--surface` on `--ground` only), keep border for the primary object; or flatten the KPI strip and forecast into one unbordered canvas. `css/views/home.css`, `campaigns.css`.
5. **Three KPIs say "Off track" in red at the same time on a brand-new month**, with a red-filled bar already; alarmist and statistically meaningless ("Not enough history yet", "0.00%"). Fix: suppress status pills until pacing is meaningful; neutral bars early in the period. `.hm-pill.is-crit`, `.hm-meter.is-crit`.
6. **Theme switch is clipped**: "System" label overflows its segment in the sidebar footer (all routes). Fix: icon-only 3-way or min-width on the first option; move to overflow menu. `app.css:106-108` `.app-theme .k-seg-opt`.
7. **390px Live campaigns table is cut off** at "Spend / bu..." on home, with no scroll affordance. Fix: render rows as stacked list below 640px (name, then spend/goal line). `.v-home` campaigns table.
8. **Analytics is dense and monotone**: 6 insight cells of prose, three of which carry an "Insight Analyst" pill (russet chip clusters), plus funnel bug-looking numbers (Clicked 631.2% of opened; "clicked -> converted: 3.4% continue"). Fix: show 3 insights, group the rest under "More"; cap funnel percentages and fix the copy; one agent dot instead of pill. `js/views/analytics.js:659`, `css/views/analytics.css`.
9. **Content Studio is a long form wall.** Six full-width inputs, image grid, generator all stacked; Preview card is cropped at the bottom ("Why this score" cut off, y~1000). Fix: make preview `position: sticky` with its own scroll or full height; move "Generate variants" into a drawer. `css/views/content.css`.
10. **Typography is flat.** Display face (Bricolage) only appears at h1/KPI; 12 to 13px grey meta strings joined by middle dots ("Autopilot · Every 6 hours · Ran just now · next in 6h") are hard to scan. Fix: split into two lines or a definition list; raise meta to 13px `--ink-2`. `js/views/console.js` roster rows.

## Remaining AI tells and stripes
- **Left stripe (violation, §11.2):** `js/ui/agent-ui.js:434`, `borderLeft: pending ? '3px solid var(--agent)'`. Replace with agent dot plus `--agent-soft` background.
- Left-edge hairline helpers, neutral, acceptable: `css/views/audiences.css:186` and `app.css:523` (drawer `border-left: 1px solid var(--line)`), `agent-ui.js:675` (segmented divider), `home.css:94` (`box-shadow: -1px 0 0` KPI dividers).
- **Uppercase labels:** `app.css:259` `.app-menu-heading` (uppercase, 0.06em tracking); `agent-ui.js:467` H4 (uppercase); `js/ui/flow.js:224` step kicker (uppercase SVG text). Switch to sentence case, `--ink-2`.
- **Glow shadow:** `agent-ui.js:619` `boxShadow: '0 0 0 3px var(--agent-soft)'` on the ran-now dot, and `app.css:155` pulse `::after` ring; keep only if it animates on real action.
- **Focus-style ring as selected state:** `content.css:103` `box-shadow: 0 0 0 1px var(--accent)`; fine, but selected items elsewhere use `inset` rings (`app.css:325`, `analytics.css:47`); unify.
- Mono face on `{first_name}` insert chips and `"+11 / -4"` score deltas (tell 5); middle-dot meta strings throughout (`·` in campaigns cards, agents roster, library rows); arrows `→` in copy (`analytics.js:659`, `flow.js:344`).
- Count bubbles after headings ("Live campaigns 2", "Needs you 0") and 0-count Approvals pill: noise when zero. 
- No `backdrop-filter`, no `linear-gradient` found in css/ or js/. Good.
- Mark: the M-journey with russet node is good and ownable, but it is a rounded blue app tile (generic container); show the bare path in the sidebar and keep the tile for favicon only. The mark also contradicts §11.2 by putting the agent color in a brand mark; use only if the node is the agent motif everywhere.

## Memorable element: three ideas
1. **The journey line as signature.** Reuse the mark's M path as a live "trace" across the top of Command Center: one thin line of the week's touchpoints, with russet nodes where an agents acted. Click a node to open the What changed entry. Replaces the KPI strip as the hero.
2. **Agent as marginalia on real objects.** One russet dot on a campaign card or chart point; hover/tap shows "Tuned by Send-Time Tuner, 2h ago" with Undo. The Analytics chart already does this with the Variant Optimizer markers; make it the system-wide idiom.
3. **A single sentence briefing.** Replace the page title area with a plain-language morning brief in the display face ("Revenue is 8% behind; Send-Time Tuner moved 3 sends; one thing needs you") with inline links, so type is the hero, not widgets.
