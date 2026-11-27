# Design direction: Mission control (binding for the agentic rebuild)

Source: `concepts/mission-control/` (index.html, mc.css, mc.js). Open it on Pages at `/concepts/mission-control/`.
It is a reference for look and tone only; its scripted playback mechanics are explicitly rejected (see below).

## Idea
An operations room for a marketing team. The goal sentence is the headline; the board shows, live, what each agent
is doing, what it handed to whom and what it produced; asks wait for you. It is live software reacting to real state,
never a scripted sequence: no play/pause/replay, no playheads, no countdowns, no delays added to be watched.

## Tokens (replace css/tokens.css palette)
| Token | Light | Use |
|---|---|---|
| `--paper` | #E7EBE3 | page ground |
| `--panel` | #F4F6F0 | artifact panels, inputs |
| `--ink` | #112019 | text, lines that matter |
| `--muted` | #53645A | secondary text (≥4.5:1 on paper) |
| `--line` | #B4C0B5 | hairlines, lane rules |
| `--ghost` | #8A998F | queued/idle states (non-text or large text only) |
| `--moss` | #1F5C46 | done work, positive, primary buttons |
| `--signal` | #FF5A1F | hand-offs, the ask, "needs you" — used sparingly |
| `--lake` / `--lake-pale` | #17667F / #CFE2E8 | in-progress work, selection |
Dark theme: derive (ground #0F1612, panel #17211B, ink #E6ECE7, muted #9DB0A4, line #2C3A31, moss #4FA37F,
signal #FF6A33, lake #4FA9C4) and re-check contrast. One typeface: Schibsted Grotesk (self-hosted), heavy weights
for the goal sentence and big numbers, tabular figures only in columns.

## Rules
- The goal sentence is set huge (clamp 32–56px, weight 700, tight leading). It is always the page headline.
- Agents have a fixed mark (small glyph) and a lane; status dot: moss done, lake working, ghost queued, signal waiting on you.
- Work is drawn, not listed: steps are blocks on each agent's lane, laid out by dependency (not by time); hand-offs are signal-orange wires with a "baton" chip that
  carries the payload ("412 people", "$2.4k split").
- Artifacts materialise in a row of panels (segment dot-grid, email render, journey, budget) with the author agent.
- Narration is a quiet column of short beats in each agent's voice; the newest beat is larger.
- The ask is the only dark surface on the page: a flight-strip card that interrupts with question, why, impact range,
  two choices. It waits for you; there is no countdown. Nothing else uses a dark overlay; no glass, no blur.
- Big live numbers (reached, sent, revenue) count up from engine values; never invented.
- Motion: only to show that something just changed (≤300 ms highlight); respects reduced motion. No choreography.
- Still banned: glassmorphism, curved left-edge stripes, gradients as decoration, sparkle/AI icons, emoji, KPI-tile
  walls, sidebar-of-objects navigation.

## Navigation
Top bar only: product mark · mission switcher (the live missions as goal-sentence tabs, plus "New goal") ·
Asks (count) · Team · Artifacts (menu: Campaigns, Audiences, Content, Results) · Connect Claude · overflow.

## Taken from Concept B (concepts/studio/)
- **Lead conversation for steering:** a collapsible column where you talk to the Lead. You give a goal, steer ("keep
  it under 10%", "skip SMS") and answer asks in place. Lead replies in one or two sentences and the plan visibly
  re-forms. This is the steering surface, not a chatbot: the work stays on the board.
- **Agent cursors on artifacts:** while a step is producing an artifact, the agent's named cursor works inside that
  panel (Scout lassoing dots, Copy Drafter's caret typing, Budget Pacer dragging the split) and leaves when done.
