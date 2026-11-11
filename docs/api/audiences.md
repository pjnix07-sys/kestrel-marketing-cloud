# audiences (L12) API reference

Files: `js/views/audiences.js`, `css/views/audiences.css`.

## Exports
- `MC.views.audiences()` is the view. Its root is `<section className="v-audiences">` with a single `<h1 id="page-title" tabIndex="-1">Audiences</h1>`.
- `MC.audiences.openInBuilder(segmentId) -> bool` loads a saved segment into the Builder draft (edit mode), sets `uiStore.focus.audiences = {tab:'builder', segmentId}` and navigates to `#audiences`. It returns false if the segment is missing.
- `MC.audiences.describeRule(rule) -> string` wraps `MC.segments.describe` and returns `''` when the engine is missing or the rule is empty.
- `MC.audiences.parts = {Builder, SegmentsTab, ProfilesTab, OverlapTab, ProfileDetail}` exposes the internal components so other views can embed them. `ProfileDetail` takes `{idx}`.

## uiStore usage
`focus.audiences = {tab:'segments'|'builder'|'profiles'|'overlap', segmentId, profileIdx}`.
- To open a tab or select a segment from elsewhere: `MC.nav.go('audiences', {tab:'segments', segmentId:'s-pnw'})`.
- `profileIdx` (a number) opens the profile drawer.

Two pieces of state live in module memory only (never in the world or localStorage), so they survive tab and route changes:
- The Builder draft (`{rule, name, editingId, text, parsed, prevRule}`).
- The Profiles segment filter and the Overlap selection.

## Store writes (all user dispatches)
- `segment/create {segment:{name, rule}}` and `segment/update {id, name?, rule?}` (from Save segment, Save changes, Save as new segment).
- `segment/remove {id}` (inline confirm in segment details).
- `campaign/setSegment {id, segmentId}` for draft and scheduled campaigns, or `campaign/include {id, segmentId, on:true}` for live and paused ones (Use in campaign).
- `proposal/approve {id}` and `proposal/reject {id, reason:'not-now'}` (Scout cards).
- `profiles/release {channel, idx:[i]}` (drawer Suppressions).

## Contract APIs consumed (all guarded at call time)
- `MC.segments`: `ATTRS evaluate traits overlap parse describe validate members eliminations nameFor`.
- `MC.select`: `segmentRows profileRow`.
- `MC.models.explain`.
- `MC.hooks`: `useSelect useUi useDebounced`.
- `MC.ui`: `Button Tabs Segmented Pill InlineConfirm Drawer DataTable AgentChip ProposalCard`.
- `MC.charts`: `BarChart Histogram HourStrip Heatmap Sparkline`.

When a kit component is missing, the view uses a local fallback. The fallbacks use `aud-btn`, `aud-tablist`/`aud-tab`, `aud-seg`, `aud-pill`, `aud-confirm` and `aud-drawer`.

How `traits()` output is normalized:
- `hist.*` may be `[{x0,x1,count}]`, `{bins}` or `number[]`.
- `tier`, `region` and `bestCh` may be `number[]`, `[{key|id,label,count|value}]` or `{key:count}`.

## Stable control ids
| Area | Ids |
|---|---|
| Tabs | `aud-tabs` (tab buttons in the fallback: `aud-tabs-{tab}`) |
| Describe | `aud-describe`, `aud-describe-build`, `aud-describe-undo` |
| Groups | `aud-g-{path|root}-op`, `-add`, `-addgroup`, `-remove` |
| Conditions | `aud-c-{path}-attr`, `-op`, `-val` (`-val2` for between; cat options `-val-{value}`), `-remove`. Path is child indices joined by `-`, e.g. `1-0`. |
| Save | `seg-name`, `aud-save`, `aud-save-new`, `aud-new`, `aud-use-campaign`, `aud-use-go` |
| Segments | `aud-seg-new`, `aud-seg-edit`, `aud-seg-profiles`, `aud-seg-overlap`, `aud-seg-delete`, `aud-scout-{proposalId}-create`, `-dismiss`, `-edit` |
| Profiles | `aud-prof-search`, `aud-prof-segment`, `aud-prof-prev`, `aud-prof-next`, `aud-prof-release-{ch}` |
| Overlap | `aud-ov-{segmentId}` checkboxes |

## CSS
Everything is scoped under `.v-audiences` with an `aud-*` prefix, except the profile drawer content (`.aud-profile`, `.aud-facts`, `.aud-preds`, `.aud-contrib`, …) and the fallback drawer (`.aud-drawer-wrap`, `.aud-drawer`). Those are prefixed but unscoped, so they still style correctly if the kit `Drawer` portals outside the view. Colors come from tokens only.

Main blocks:
- Layout: `aud-builder-grid` (7/5, stacks under 960px), `aud-live` (sticky panel), `aud-group`/`aud-depth-{1..3}`, `aud-cond`.
- Builder parts: `aud-chips`/`aud-chip`/`aud-chip-ign`, `aud-pred-badge`.
- Segments: `aud-scout`/`aud-scout-card`, `aud-table`.
- Profiles and overlap: `aud-pager`, `aud-overlap-grid`.
