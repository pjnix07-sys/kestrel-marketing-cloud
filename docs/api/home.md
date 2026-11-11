# home (Command Center) API reference (as implemented)

Files: `js/views/home.js`, `css/views/home.css`.

## Exports
- `MC.views.home`: a React function component with no props. Its root is `<section className="v-home">`, and it renders one `<h1 id="page-title" tabIndex="-1">Command Center</h1>`. It never moves focus or scroll in response to a tick. Nothing else is exported.

## Store reads
Reads go through `MC.hooks.useSelect` with stable module-level selectors. Before `MC.store.init`, the view renders a boot note and skeleton KPI tiles.
- `MC.select.kpis(w)` feeds the KPI strip.
- `MC.select.forecast(w,{month:true,metric:'revenue'})` is passed straight to `MC.charts.ForecastChart` with `data` and `cumulative`.
- `MC.select.agentMarkers(w,{fromDay:monthStart,toDay:today})` is grouped into one agent marker per day.
- `MC.select.movers(w)`, `MC.select.openProposals(w)`, `MC.select.agentRoster(w)` and `MC.select.campaignRows(w)` (status `live` or `paused`).
- It also reads the raw slices `w.feed` and `w.proposals`, and `w.meta.tick` / `w.meta.tenant`.
- Every `MC.select.*` call is guarded. A missing or throwing selector renders an empty or skeleton state.

## Dispatches (user path)
- `proposal/approve`, `proposal/reject {reason}`: only in the fallback mini card. Normally `MC.ui.ProposalCard` does this.
- `proposal/undo {id}`: the Undo link on `agent-applied` / `approved` feed rows. An error shows inline on the row.

## Navigation
- KPI tiles call `MC.nav.go('analytics',{metric:'revenue'|'conversions'|'roas'|'unsubRate'})`.
- "Plan a campaign" calls `go('campaigns',{mode:'planner'})`.
- Campaign rows and movers call `go('campaigns',{mode:'detail',id,tab:'overview'})`.
- Agent rows call `go('agents',{tab:'roster',agentId})`. Forecast markers call `go('analytics',{metric:'revenue',showAgents:true})`.
- "Review approvals" and "See all N in Approvals" call `MC.uiStore.set({drawer:'approvals'})`.
- Feed "View" resolves to the target campaign, variant (content), segment (audiences), analytics (for anomalies and insights) or the agent.

## Components reused (looked up at render time, with local fallbacks)
- `MC.ui.Button`, `AgentChip`, `ProposalCard` (`compact`, `showTarget`), `AgentPulse`, `StatusDot`, `NewItemsPill`.
- `MC.charts.Sparkline`, `MC.charts.ForecastChart`.
- `MC.hooks.useFrozen` freezes the feed while it is scrolled or focused, and the Needs-you list while it has hover or focus.

## Stable ids
- Panels: `home-forecast`, `home-needs`, `home-changes`, `home-agents`, `home-live`. Each has a matching `{id}-title` h2.
- KPI tiles: `home-kpi-revenue`, `home-kpi-conversions`, `home-kpi-roas`, `home-kpi-unsub`.
- Feed: `home-feed-list` (the scroll box) and `home-feed-filter-{all|agents|anomalies|campaigns|yours}`.
- Quick actions: `home-quick-approvals`, `home-quick-content`, `home-quick-audience`, `home-quick-analytics`, `home-quick-agents`.
- Rows: `home-agent-{agentId}`, `home-live-{campaignId}`.

## CSS (all scoped under `.v-home`, tokens only)
- Layout:
  - `hm-grid` with areas `hm-area-kpi`, `-needs`, `-fc`, `-feed`, `-agents`, `-live`.
  - At ≥960px the grid is 2fr/1fr in the §7.1 order. Below that it is one column in the phone order: KPI, Needs you, Forecast, What changed, Agents, Live.
  - `hm-kpis` is 2×2, or 4 across at ≥960px.
- Pieces:
  - Panel, head and quick actions: `hm-panel*`, `hm-head*`, `hm-quick*`.
  - KPI tiles: `hm-kpi*`, plus `hm-flash` (`.is-agent` for russet), the 1.2s change underline that is hidden under reduced motion.
  - `hm-meter*` (fill, ghost forecast segment, goal tick) and `hm-pill.is-{neutral|accent|agent|good|warn|crit}`.
  - Feed: `hm-feed-*`. Forecast and movers: `hm-fc-*`, `hm-mover*`.
  - Agents: `hm-agent*` and `hm-dot.is-{running|paused|off|queued}`. Table: `hm-table` inside `hm-scroll k-scroll-x`.
