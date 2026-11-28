# A product, not a simulation (binding for the product round; amends AGENTIC.md and DESIGN-DIRECTION.md)

User direction (Nov 28): "still too on the nose and tries to simulate a live marketing organization; this is to function
as a product, not an interactive game. I like the UI and the functionality is very good." Asks: use the dataviz skill to
present information with organisation and wow factor; be dead simple in UI and navigation; go back to a vertical side
bar, minimal, icons with the name on hover, without losing any functionality; a beginner can understand and use it, an
advanced user gets more out of it.

Thesis (unchanged at the core): you give the product goals; agents do the marketing work toward them and ask you only for
real decisions. What changes is the framing: it reads like software you use, not an organisation you watch.

## 1. What makes it feel like a game, and the fix
| Game tell | Product behaviour |
|---|---|
| The world clock races (1 hour per 5 s); numbers move while you read | Data is as of now and advances in real time: one world hour per real hour. Nothing changes on screen unless something really happened (an agent finished work, a send went out, you acted). |
| Missions advance on that fast clock | Agent work runs on its own work pulse: a step is claimed as soon as its inputs are ready and finishes ~1 s later (a Claude-backed step takes as long as the call). Logged catalog action, so replay stays exact. |
| "Missions", "Your team of nine", "teammates", "hand-offs", "waiting on you" | **Goals**, **Agents**, "done", "needs your decision". Agent names stay (they are feature names) but speak in plain product voice: past-tense facts, no chat banter. |
| Lead chat bubbles narrating ("Got it! I'll …") | An **Activity** log of facts ("Plan created: 6 steps", "Audience sized: 671 people") plus the Steer box. The Lead is "Planner" in copy. |
| A banner announcing a fictional brand | A quiet "Sample workspace" label in Settings and the workspace name in the rail's tooltip; Reset lives in Settings. |
| Persona switching, tour narration | A "Getting started" checklist (3 to 5 real tasks), dismissible, in Help. |

## 2. Navigation: a minimal icon rail (supersedes the top bar and the CLAUDE.md sidebar ban for this shape)
Left rail, 64 px, icons only; the name shows on hover and on keyboard focus (tooltip, 300 ms delay, no delay when
moving between items), and is the accessible name. Active item: a filled square background, no stripe.
Order (top): mark; **New goal** (+); **Home**; **Goals**; **Approvals** (count badge); **Campaigns**; **Audiences**;
**Content**; **Results**; **Agents**. Bottom: **Search** (⌘K or /); **Help** (Getting started, shortcuts); **Claude**
(connect state dot); **Settings** (theme, detail level, notifications, reset sample workspace).
Under 760 px wide: a bottom bar with Home, Goals, Approvals, Results and More (sheet listing every other item with names).
No top bar. Each page starts with its own header: title, one plain sentence of what is happening, the primary action.

## 3. Beginner to advanced: one product, two depths
- Every page leads with the answer in one plain sentence and at most one primary action.
- Settings → **Detail level: Simple (default) / Detailed**. `MC.uiStore.detail`. `MC.ui.Details` disclosures are closed in
  Simple and open in Detailed; any one can still be opened. Advanced material (intervals, holdout method, rule builders,
  run traces, agent reasoning options, raw tables) lives inside `Details`, never removed.
- Jargon gets a plain definition on first use per page (title attribute or a short inline gloss): lift, holdout,
  interval, segment, variant, cadence cap.
- Empty states say what to do next and offer the button.

## 4. Data presentation (the dataviz skill is binding: `dataviz` SKILL.md and references)
Procedure per chart: pick the form by the data's job, then colour by job, then validate the palette with
`validate_palette.js` (light and dark), then marks, hover, accessibility, then render and look.
- Palette: replace `--chart-*` with a validated categorical set (fixed order, never cycled), one sequential hue, one
  diverging pair with a neutral midpoint, status colours reserved. Dark mode is selected, not flipped.
- Marks: thin, 4 px rounded data-ends on the baseline, 2 px lines, 2 px surface gaps, recessive grid, selective direct
  labels, legend for 2+ series, table view, hover tooltip on every mark (crosshair on lines). One axis only.
- Forms: goal progress = actual line against the straight pace line to target with the forecast band to the deadline
  and a hero number; revenue over time = line with forecast band; channel and angle comparisons = sorted bars or dot +
  interval; audience × angle = diverging dot + interval around zero; composition = one stacked bar, not pies.
- Home: a hero line ("$40.3k from your goals this month, 3 decisions waiting"), each goal as a row with its progress
  chart and verdict, Approvals list, one revenue chart. No KPI-tile walls.

## 5. Unchanged
Static, no build; logged actions and exact replay; every number from `MC.metrics`/`MC.affinity`; asks wait for a person;
the plan board shows real steps by dependency (calmer styling, no racing); visual bans other than the sidebar remain
(glassmorphism, curved left stripes, decorative gradients, sparkle/AI icons, emoji, KPI-tile walls).
