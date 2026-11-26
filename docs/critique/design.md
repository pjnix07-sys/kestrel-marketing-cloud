# Design critique: Kestrel Marketing Cloud

Assumptions: both themes reviewed; sample data is a fresh session, so empty states are real; CONTRACT §11 is the bar; the sidebar ending mid-page in full-page shots is a capture artifact.

## Verdict
Clean, restrained and token-coherent, with a palette that avoids the cream/terracotta cliche, and §11 is mostly honored. But it reads as a competent generic SaaS dashboard: identical white bordered boxes, one radius, no signature moment, and the agentic idea is the weakest-drawn part of the Command Center. One real left stripe remains, plus clipped controls that undercut "award-quality".

## Top 10 issues
1. **Home hero is empty.** "What changed" says "Nothing yet" while the forecast takes the prime slot. Fix: feed first, full width; seed 3 to 4 entries at boot; collapse empty "Needs you" to a header line. `js/views/home.js`, `css/views/home.css`.
2. **Dead holes in the home grid** (1440, right column under "Needs you", left under "What changed"). Fix: one main column plus narrow rail. `.v-home` grid.
3. **Eight identical agent rows** reading "first run pending". Fix: list only agents that acted or need you; link to Agents. `js/views/home.js`.
4. **Everything is the same bordered white box** (home panels, campaign cards, KPI strip). Fix: borderless `--surface` on `--ground`, keep a border only on the primary object. `home.css`, `campaigns.css`.
5. **Three red "Off track" pills and red bars on day 26 of a new month** with "Not enough history yet"; alarmist, meaningless. Fix: neutral until pacing is meaningful. `.hm-pill.is-crit`, `.hm-meter.is-crit`.
6. **Theme switch clipped**: "System" overflows its segment (all routes). Fix: icon-only or widen first option; or move to overflow menu. `app.css:106-108`.
7. **390px home campaigns table cut off** at "Spend / bu…", no scroll cue. Fix: stacked rows under 640px. `.v-home` table.
8. **Analytics is dense prose** (six insight cells, three with russet "Insight Analyst" pills) and the funnel reads wrong ("Clicked 631.2% of opened"; "clicked → converted: 3.4% continue"). Fix: show 3 insights, rest under "More"; fix the funnel math/copy; dot instead of pill. `js/views/analytics.js:659`.
9. **Content Studio is a form wall**; Preview card is cropped ("Why this score" cut off) at 1440. Fix: sticky full-height preview; move "Generate variants" into a drawer. `css/views/content.css`.
10. **Flat typography**: display face only on h1/KPIs; meta lines like "Autopilot · Every 6 hours · Ran just now · next in 6h" are 12px grey. Fix: two lines, 13px `--ink-2`. `js/views/console.js` roster.

## Remaining AI tells and stripes
- **Left stripe (violates §11.2):** `js/ui/agent-ui.js:434`, `borderLeft: pending ? '3px solid var(--agent)'`. Use an agent dot and `--agent-soft` background.
- Neutral left hairlines, acceptable: `app.css:523`, `audiences.css:186` (drawer), `agent-ui.js:675` (segment divider), `home.css:94` (KPI divider shadow).
- **Uppercase:** `app.css:259` `.app-menu-heading`; `agent-ui.js:467` H4; `js/ui/flow.js:224` kicker. Use sentence case.
- **Glow:** `agent-ui.js:619` `0 0 0 3px var(--agent-soft)`; pulse ring `app.css:155` (keep only when an agent acts).
- Inconsistent selected rings: `app.css:325`, `analytics.css:47`, `content.css:103`; unify.
- Mono for `{first_name}` chips and score deltas; middle-dot meta strings (cards, roster, library); `→` in copy (`analytics.js:659`, `flow.js:344`).
- Count bubbles after headings and a zero Approvals pill ("Needs you 0") are noise.
- No `backdrop-filter` or `linear-gradient` in css/ or js/. Good.
- Mark: the M-journey path with russet node is ownable, but the blue rounded tile is generic; show the bare path in the sidebar, tile for favicon.

## Memorable element: three ideas
1. **Journey line hero.** The mark's M path as a thin live trace across the top of Command Center, russet nodes where agents acted; click a node to open its What changed entry. Replaces the KPI strip.
2. **Agent marginalia.** One russet dot on any object an agent touched; hover shows "Tuned by Send-Time Tuner, 2h ago" with Undo. Analytics chart markers already do this; make it the system idiom.
3. **One-sentence briefing.** A plain-language morning brief in the display face ("Revenue is 8% behind; Send-Time Tuner moved 3 sends; one thing needs you") with inline links, so type is the hero.
