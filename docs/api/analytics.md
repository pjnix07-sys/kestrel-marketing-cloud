# analytics (L13, view) API reference (as implemented)

Files: `js/views/analytics.js`, `css/views/analytics.css`.

## Exports
- `MC.views.analytics`: React function component, no props. Root `<section className="v-analytics">` with one `<h1 id="page-title" tabIndex="-1">Analytics</h1>`.
- `MC.views.analytics.helpers`: pure, deterministic helpers (no store writes):
  - `fitCurve(points:[{spend,revenue}]) -> {A,B,r2,sd,prior?} | null`. Uses `MC.models.fitResponse` when present. Otherwise it applies the §5.4 grid fit, with a prior fallback when r² < 0.3.
  - `response(c,s)` and `marginal(c,s)`: `MC.models.*` when present, otherwise `A(1−e^{−s/B})` and `(A/B)e^{−s/B}`.
  - `optimizeSplit(curves:{[ch]:{A,B}}, totalDaily) -> {[ch]:daily}`: equal marginal return, using bisection on λ.
  - `ewmaFlags(values, {lambda=.2, z=3, minN=7}) -> [{i,value,expected,z}]` (only flagged points; uses `MC.models.ewma` when present).
  - `simulate(data, plan:{[ch]:daily}) -> {nowRev,newRev,nowSpend,newSpend,lo,hi,fitted,unfitted[]}` (totals over the remaining days).
  - `whatIfData(world, cid) -> {cid,name,status,daysLeft,budgetByCh,channels:[{ch,budget,spentBefore,current,curve,n}]} | null`. Memoized per campaign by `[campaign, day, days.length, world]`. The curve is fit on complete days within the last 21 days. `current` comes from `MC.sim.dailyBudget`.

## State read and written
- Reads `uiStore.focus.analytics = {range:14|30|60|'all', campaignIds:[], channel:'all'|ch, metric, showAgents}`. Invalid values are normalized at render time. Unknown campaign ids are dropped. Metrics: `revenue|conversions|clicks|roas`. Other `MC.select` metrics, such as `unsubRate` from a Home KPI tile, are accepted and added to the Metric select.
- Writes `MC.uiStore.setFocus('analytics', patch)` from the filter bar and from insight evidence links.
- Dispatches only on a user click: `insight/dismiss {id}`, `campaign/setBudget {id, byChannel}` (totals = spentBefore + daily×daysLeft, after an inline confirm), and `agent/runNow {id:'pacer'}`.
- Selectors used: `series, forecast (+ {month:true}), agentMarkers, insights, agentImpact, targetCampaignId, liftVsControl, funnel, channelCompare, variantStats, attribution, segmentRows`.

## Sections (ids = section element id; heading id = `{id}-title`, focusable)
`analytics-performance`, `analytics-insights`, `analytics-agent-impact`, `analytics-anomalies`, `analytics-funnel`, `analytics-channels`, `analytics-attribution`, `analytics-audiences`, `analytics-whatif`.

Control ids: `analytics-range`, `analytics-campaigns` (chips `analytics-campaign-{cid}`), `analytics-channel`, `analytics-metric`, `analytics-show-agents`, `analytics-split`, `analytics-funnel-channel`, `analytics-channel-measure`, `analytics-variant-campaign`, `analytics-variant-channel`, `analytics-attr-model`, `analytics-whatif-campaign`, `analytics-whatif-{ch}`. Table ids: `analytics-impact-table`, `analytics-channel-table`, `analytics-variant-table`, `analytics-attr-table`, `analytics-audience-table`.

Deep link for other views: `MC.nav.go('analytics', {metric:'revenue', campaignIds:['c-wll'], range:30})`.

## Behavior notes
- Performance has three modes: total (complete days, a 14-day Holt forecast with 80/95% bands, a goal-pace line for a single campaign, EWMA anomaly diamonds, Black Friday and other event lines), by campaign, and by channel. Clicking an agent marker opens a `MC.ui.ProposalCard` inline callout.
- Live-safe: what-if sliders keep a local draft (`null` = follow the live values). Tables update values in place, and their sort order is frozen while focused. The anomaly list uses `MC.hooks.useFrozen` while focused. No focus or scroll calls happen on store changes.
- Kit fallbacks: uses `MC.ui.Segmented / Button / Pill / AgentChip / InlineConfirm / ChipToggle / NewItemsPill / ProposalCard` when present, and otherwise renders accessible local equivalents. Tables and selects are always local (native `<select>`, `an-table`).

## CSS classes (all under `.v-analytics`)
`an-pagehead an-h1 an-asof an-filters an-filter an-filter-label an-select an-check an-chips an-chip(.is-on) an-seg an-seg-opt(.is-on) an-btn(-primary|-secondary|-ghost) an-link an-pill an-tone-{neutral|good|warn|crit|agent|accent} an-agent-chip an-newpill an-grid an-cell an-span-{12|7|6|5} an-card an-card-head an-card-title an-card-sub an-card-actions an-card-body an-subhead an-headline an-muted an-note an-meta an-error an-actions an-inline-controls an-empty an-stats an-stat an-stat-sub an-table-wrap an-table an-th an-td an-sort an-sub-num an-swatch an-swatch-label an-lifts an-lift an-callout an-variants an-anomalies an-anomaly an-sev-{warn|crit|info} an-insights an-insight an-whatif an-whatif-summary an-curves an-curve an-range an-confirm an-msg`. The filter bar's sticky offset reads `var(--app-topbar-h, 60px)`, and the bar is static below 640px.
