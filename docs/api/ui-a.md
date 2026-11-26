# ui-a: shell, tokens, kit, icons

Files: `index.html`, `css/tokens.css`, `css/app.css`, `js/ui/icons.js`, `js/ui/kit.js`, `js/app.js`.

## index.html
Complete HTML5 document (GitHub Pages target): doctype, `<html lang="en">`, charset, viewport
(`width=device-width, initial-scale=1, viewport-fit=cover`), title, Google Fonts, then the CONTRACT §10.2
stylesheet and script order unchanged. All local URLs are relative (works under `/kestrel-marketing-cloud/`).
Files not yet built 404 harmlessly; the shell degrades (see below).

## css/tokens.css
Full light palette on `:root` (§10.13 table), dark overrides under
`@media (prefers-color-scheme: dark){:root:not([data-theme="light"])}` and `:root[data-theme="dark"]`, both `color-scheme: dark`.
Extra tokens: `--scrim`, `--chart-1..6`, `--chart-grid`, `--chart-band`, `--shadow-pop`, fonts `--font-display/ui/mono`,
type `--text-xs..2xl`, spacing `--space-1..7` (4/8/12/16/24/32/48), radii `--radius-sm/md/lg/pill`,
layout `--app-gutter` (clamp 16–32px), `--app-max` 1440, `--app-sidebar-w` 232, `--app-rail-w` 64,
`--app-topbar-h` (60px; 56px below 640px), `--app-hit` 40px, motion `--ease --dur-fast --dur`.

## css/app.css
Base, `.num` (tabular-nums), `.sr-only`, global `:focus-visible` (also `svg g[tabindex]`), `.k-scroll-x`,
shell (`app-*`: sidebar 232 / icon rail 640–959 / hidden < 640, sticky top bar, phone bar, menu sheet, sample strip,
boot card, fault card, dev check), kit classes (`k-*`), chart and agent polish hooks (`ch-*`, `ag-*`),
`html.k-lock` scroll lock, reduced-motion rule removing transitions/animations.

## js/ui/icons.js
`MC.icons` name → SVG path data (nav, status, channel, agent and action glyphs, `mark` (journey line)).
`MC.ui.Icon({name, size=16, title})` (aria-hidden unless titled). `MC.ui.Scene({imageId, title})` renders the six
synthetic `MC.copy.IMAGES` illustrations (scene-summit/forest/campfire/trail/snow/lake) with token colors.

## js/ui/kit.js
Hooks: `MC.hooks.useWidth(ref) -> number` (0 before first measure, ResizeObserver), `useMedia(query) -> bool`,
`useReducedMotion() -> bool`.
Helpers: `MC.ui.cx(...)`, `MC.ui.fmtValue(v, format, row)` (format fn or preset `money|moneyCompact|cents|pct|pct2|pp|delta|ratio|compact|int`),
`MC.ui.agentName(id)`.
Components (all accept `id`; Button/IconButton also pass through `aria-*`, `data-*`, `title`, `tabIndex`, focus/key/mouse handlers):
- `Button {kind:'primary'|'secondary'|'ghost'|'danger', size:'sm'|'md', icon, iconRight, onClick, disabled, busy, block, title, type}`
- `IconButton {icon, label (aria), onClick, pressed, badge, size, kind}`
- `Segmented {id, label, options:[{value,label,icon?,iconOnly?,ariaLabel?,disabled?}], value, onChange, size, block, disabled}` — radiogroup, option ids `${id}-${value}`, arrows/Home/End.
- `Field {id, label, hint, error, children}`; `TextInput / TextArea / NumberInput / Select / Slider / Checkbox` `{id, value, onChange(value), onBlur, maxLength, counter, ...}`; `ChipToggle {id, label, icon, checked, onChange, size}`
- `Tabs {id, label, tabs:[{id,label,count,countTone}], value, onChange, panelId, size}` — tab ids `${id}-${tab.id}`, arrow keys.
- `Badge / Pill / StatusPill {tone, children}`, `StatusDot {state, pulse, label}`
- `Panel {id, title, sub, actions, footer, dense, children}`, `KPI {label, value, format, goal, goalLabel, forecast, delta, deltaFormat, invert, spark, status, onClick, note}`
- `Meter / ProgressBar {value, max, goal, ghost, tone, label, valueText}`, `Delta {value, format, invert, suffix, neutral}`, `Money`, `Num`
- `DataTable {columns:[{key,label,align,format(v,row),render(row),sort,sortValue,width}], rows, rowKey, onRowClick, selectedKey, freezeOrderWhileFocused=true, pageSize, empty, caption, initialSort, dense, label, rowClassName}`
- `EmptyState {icon, title, body, action}`, `Skeleton {w, h, lines}`
- `Drawer {open, onClose, title, width=440, side:'right'|'left'|'bottom', footer, headerExtra, initialFocus, returnFocusRef}` (portal, focus trap, Esc, scroll lock); `Sheet` = bottom Drawer
- `Popover {anchorRef, open, onClose, label, placement, width}`, `Tooltip {label, children}`
- `InlineConfirm {message, confirmLabel, cancelLabel, onConfirm, onCancel, tone, busy}`
- `ConflictChip {agentId, onTheirs, onMine}`, `NewItemsPill {count, onClick, label}`, `SampleDataBadge`
- `ToastHost` — reads `uiStore.toasts`, shows last 3, `aria-live=polite`, 6 s auto-hide paused on hover/focus; actions `undo` (dispatches `proposal/undo`), `review` (opens approvals drawer), `view` (`MC.nav.go(route, focus)`).

## js/app.js
- Guards: missing React/ReactDOM/htm → "Couldn't load the interface libraries. Check your connection and reload."; missing core store → friendly error card.
- Shell: sidebar (mark, nav with pending badge on Agents and "Soon" for unregistered views, tenant + Sample data, theme segmented), desktop top bar (title/breadcrumb, sim clock + sim day, speed `Pause·1×·4×·16×` + `Step 1h` while paused, `MC.ui.AgentPulse`, Approvals button, overflow menu: Restart simulation with inline confirm, Audit & replay, re-show sample note), phone top bar (mark, title, compact clock, play/pause, approvals, menu → left sheet with nav, speed, pulse, theme).
- Approvals drawer (`uiStore.drawer === 'approvals'`, reachable from every route): tabs Needs you / Applied by agents / History, agent and risk filter chips, `Approve all low-risk (n)` with inline confirm (`proposal/approveMany`), `useFrozen` list with new-items pill, `MC.ui.ProposalCard`.
- Theme via `MC.uiStore.applyTheme(theme)`; route via `uiStore.route` (hash handled by `MC.nav`); focus to `#page-title` on route change only.
- Views wrapped in an ErrorBoundary ("This view hit an error." + Reload view); missing `MC.views.x` → "This area is still being built."
- Boot: `MC.engine.boot({seed: MC.SEED, onPhase})` with a phase card; missing simulator parts produce a readable error and Try again.
- Toasts: one coalesced toast per tick from new `agent-applied` / `agent-proposed` feed items, honoring `uiStore.notify`.
- Dev check: collapsible list of `MC.contract.check().missing` when non-empty.
