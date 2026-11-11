# ui-b (L7 ui-viz) API reference

Files: `js/ui/charts.js`, `js/ui/flow.js`, `js/ui/agent-ui.js`. All are React function components used via htm:
`html\`<${MC.charts.LineChart} series=${s} />\``. Colors only come from tokens (`--chart-1..6`, `--chart-grid`, `--chart-band`, `--agent`, `--accent`, and the status tokens), set through inline `style`. No CSS file is needed; the `ch-*` / `ag-*` class names exist as hooks for optional polish.

## Shared conventions (charts)
- **Width:** each chart measures its container with `MC.hooks.useWidth(ref)` (falling back to a local ResizeObserver) and renders an SVG with `width:100%` and a `viewBox`. It never sets a fixed width wider than the container. The Heatmap, Gantt and FlowDiagram scroll inside `.k-scroll-x`.
- **Formats:** a `format` / `yFormat` / `xFormat` prop accepts a function or one of `'num' | 'compact' | 'money' | 'moneyCompact' | 'money-compact' | 'pct' | 'ratio' | 'int'`. These map to `MC.fmt.*` when it exists. Non-finite values render as `–`.
- **x values:** in LineChart and ForecastChart, x values are **sim days** by default (labels like "Nov 7", computed with day 0 = 2026-11-07). Pass `xFormat` to change this.
- **Safety:** empty, NaN or missing data renders a dashed empty box with a message (override it with `emptyText`) and never throws.
- **Accessibility and interaction:** every chart has `role="img"`, an `aria-label` (auto-generated or set with `ariaLabel`) and a `<title>`. A `View as table` toggle appears on every chart except Sparkline and ScoreRing; pass `noTable` to hide it. A legend appears for 2 or more series.
- **Hover:** tooltips are keyed by x value or by key, never by array index, so they persist across ticks. In LineChart, the plot (`.ch-plot`, tabIndex 0) also supports ←/→/Home/End/Esc.

## MC.charts
| Name | Props (beyond the contract defaults) |
|---|---|
| `Sparkline` | `{values, width=96, height=24, color, area, ariaLabel, highlightIndex?, zero?}`. `highlightIndex` draws a crit diamond (for anomaly lists). |
| `LineChart` | `{series:[{id,label,color,points:[{x,y}],dashed}], band?:{points:[{x,lo,hi}]}, band95?, forecastFrom?, forecastLabel='Forecast', goal?:{y,label}, markers?:[{x,kind:'agent'\|'anomaly'\|'event',label,onClick?,y?,tone?:'warn',id?}], xFormat, yFormat, height=240, ariaLabel, yZero=true, xLabel, bandLabel, emptyText, noTable}`. Agent markers sit on a russet rail under the axis and are focusable buttons that call `onClick(marker, event)`. Anomaly diamonds take `y` or the first series' value at x. |
| `ForecastChart` | `{actual:[{day,value}], forecast:[{day,mean,lo80,hi80,lo95,hi95}] (alias points), goal:number\|{y,label}\|{value}, nowX, nowLabel='Today', cumulative, markers, yFormat, xFormat, height, ariaLabel, labels:{actual,forecast}, hide95, color, data?}`. `data` accepts a `MC.select.forecast()` result directly. In cumulative mode it builds running sums, and the bands combine variances as √ΣVar. |
| `BarChart` | `{data:[{key,label,value,ci?:[lo,hi],color?}], orientation:'h'(default)\|'v', format, highlightKey, onSelect?(key,d), height (v only, 200), categoryLabel, valueLabel, label, ariaLabel}`. Supports negative values. Non-highlighted bars are drawn at 45% opacity. |
| `StackedBar` | `{rows:[{key,label,parts:[{key,value}]}], keys:[{key,label,color}], format, rowLabel, ariaLabel}`. Horizontal, with 2px gaps and the total at the end. |
| `Funnel` | `{stages:[{key,label,value}], format, color, ariaLabel}`. Shows "X% of previous". |
| `Histogram` | `{bins:[{x0,x1,count}], height=56, color, format, marker?:number, label}` |
| `HourStrip` | `{values:number[24], highlight?:number\|number[], quiet?:[start,end], height=56, format, valueLabel, noLegend}` |
| `Heatmap` | `{rows:(string\|{key,label})[], cols:same, values:number[][], format, onCell?(ri,ci,{row,col,value}), min?, max?, rowLabel, label}`. Single-hue sequential scale; cells are buttons when `onCell` is set. |
| `ResponseCurve` | `{curve:{A,B}, current, proposed?, maxSpend?, format='moneyCompact', height=160, label, color}`. Uses `MC.models.response`/`marginal` when present and annotates "Next $1 returns $x.xx". |
| `ScoreRing` | `{value 0–100, size=40, label}`. Accent arc with the number in the center. |
| `FlowDiagram` (flow.js) | `{steps, stats:{[stepId]:{inStep,sentToday,yesPct?,noPct?,branchPct?}}, tags:{[stepId]:{agentId,text}}, selectedId, onSelect?(stepId, step), orientation:'auto'\|'h'\|'v', compact, ariaLabel}`. Layout is BFS layers from the `entry` step; it goes vertical under 640px. Back-edges are dashed. Percentages ≤ 1 are treated as fractions. |
| `Gantt` (flow.js) | `{rows:[{id,label,start,end,status}], now, markers:[{x,label}], onSelect?(id,row), selectedId, from, to, unit:'tick'(default)\|'day', ariaLabel}`. **All x values are ticks** unless `unit:'day'` (Thanksgiving = `19*24`). Minimum width is 720 inside `.k-scroll-x`. Bars are styled by status: draft is dashed, scheduled is accent-soft, live is accent, paused is warn-soft, completed is line. |
| `Legend` | `{items:[{key,label,color,kind?:'swatch'\|'line'\|'band',dashed}]}` |
| `ChartFrame` | `{ariaLabel, legend, table:{columns:[{key,label,align}],rows:[{_key,...}]}, render(width), className, noTable}`. The building block for custom charts. |
| `util` | `{fin, clamp, niceTicks, linScale, extent, tokenColor, resolveFmt, FORMATS, shortDay, hourLabel, truncate, textW, useChartWidth, Tip, TipRow, TableView, EmptyChart, barPathH, barPathV, diamond, S}` |

A `color` prop is a token name such as `'chart-2'`, `'--chart-2'` or `'var(--chart-2)'`. When it is omitted, colors follow the series index in fixed order.

## MC.ui (agent-ui.js)
| Name | Props / behavior |
|---|---|
| `AgentChip` | `{agentId, size:'sm'\|'md', showName=true, title}`. A russet pill. `'user'` or an empty id renders "You". The name comes from `MC.runtime.def(id).name` (with a built-in fallback). |
| `ProposalCard` | `{id, compact, showTarget}`. Reads `proposals.byId[id]`, `meta.tick`, `campaigns`, `variants` and `MC.runtime.undoCheck` through `MC.hooks.useSelect`. It dispatches `proposal/approve`, `proposal/reject {reason:'not-now'\|'wrong'\|'other'}` and `proposal/undo`, and shows dispatch errors inline. It derives an AllocationBar before/after from a `campaign/setAlloc` action (before = current alloc while pending, the inverse payload once applied). "Open campaign" calls `MC.nav.go('campaigns',{mode:'detail',id,tab:'overview'})`; segment and variant targets go to audiences or content. Its root is an `<article>` with a `<h3 id="proposal-{id}-title">`. |
| `GuardrailList` | `{items:[{id,label,pass?,status?,detail,blocking,locked?}], compact, ariaLabel}`. Status is `status`, or comes from `pass` (`pass:false` with `blocking:false` → warn). Uses SVG check/cross/warn glyphs. |
| `DiffTable` | `{rows:[{label,before,after,strike?}]}`. Numbers, booleans, arrays and objects are stringified. |
| `AllocationBar` | `{parts:[{key,label,share}], previous?: [{key,share}] \| {key:share}}`. Draws a thin "before" bar, a 12px "after" bar and a legend row "A 50% → 35%". |
| `ImpactBadge` | `{impact:{metric,delta,lo,hi,unit:'$'\|'#'\|'pp',horizonDays,confidence,tradeoff?}, realized?:{delta,method}, measuring?, hoursLeft?}` |
| `TraceView` | `{auditId}`. Finds the audit entry (cached by entries array) and renders Observe (rows plus `in` digest), Decide (numbered), Guardrails (trace plus the created proposals' lists), Actions called (mono `type {id:…, channel:…} #digest`), and a footer with `out`, `chain` and `ran in N ms`. |
| `AgentPulse` | `{compact, onClick?}`. Eight dots built from `MC.select.agentRoster` (or `world.agents`). A dot is filled and ringed when `lastRun === tick`; hollow means paused; grey means off. Text reads "7 agents working · 4 need you" or "Agents paused". The default click calls `MC.nav.go('agents',{tab:'roster'})`. |
| `AutonomyControl` | `{agentId, id='agents-{agentId}-autonomy', label, showHelp=true}`. Uses `MC.ui.Segmented` when present, otherwise its own radiogroup with arrow keys. Only `def.autonomy.allowed` options are shown. Dispatches `agent/setAutonomy`. |
