# Demo script and guided first-run spec

## Part 1. Five-minute demo

For an exec or prospect. Open the live site (https://pjnix07-sys.github.io/kestrel-marketing-cloud/) or a local server before the meeting, and let the app load for 30 seconds so the agents have acted. Start in light mode, on a wide window.

| Min | Click | Say | What it shows |
|---|---|---|---|
| 0:00 | Command Center | "This is Fernway Outfitters, a made-up outdoor brand. One screen: how we're doing, what changed, what needs me." | KPI strip, goal progress, forecast. |
| 0:45 | "What changed" feed | "Eight agents work in the background. This is what they did since you last looked, in plain words." | Agent actions with View and Undo. |
| 1:30 | Approvals (top bar) | "Anything an agent isn't allowed to do alone waits here. Each has a reason, an expected range, the checks it passed and the exact change." | A proposal's why, impact, guardrails and diff. Approve one. |
| 2:15 | Undo an autopilot action in "What changed" | "Anything an agent did by itself can be reversed." | Undo, and the feed updating. |
| 2:45 | Campaigns, then the planner brief field | Type: "Win back lapsed customers with free shipping, email and push, two weeks, $4k". "I describe the goal; the Campaign Planner drafts the journey, budget split and audience." | A plan you edit section by section. Preflight checks before scheduling. |
| 3:45 | Agents, Roster | "You set each agent to Off, Suggest or Autopilot. Guardrails such as consent and drafts-are-protected can't be switched off." | Autonomy per agent, run history, guardrails tab. |
| 4:30 | Connect Claude (only if the prospect has a key) | "Bring your own key and the agents use Claude Haiku for judgment and writing. Only aggregate numbers leave the browser." | Same flow, same guardrails, now with written reasons. |
| 4:50 | Close | "Everything you saw is sample data. Which of these workflows would you want first?" | |

Notes for the presenter:
- If asked "is this real?": the data is synthetic and the page runs entirely in the browser. There is no backend.
- If an approval list is empty, wait a minute; agents run on the app's own clock, and "Jump ahead" in the overflow menu advances a day.
- "Reset sample data" in the overflow menu returns to the start.
- Without a key, everything works on rules. Do not promise live AI unless you have connected one.

## Part 2. Spec: guided first-run

### Problem

A new visitor lands on a dense Command Center. The agents, approvals and autonomy levels are the product, but nothing points to them, so first-time viewers miss them. Evaluators spend minutes finding the first proposal.

### Goals

- A first-time visitor approves or dismisses one proposal within 2 minutes.
- At least half of first-time visitors reach the Agents screen.
- No returning visitor sees the guide again unless they ask.

### Non-goals

- A product tour for every screen. Only the agent loop is covered.
- Video, modals that block the page, or a forced sequence.
- Server-side tracking. State stays in the browser.

### Steps

Copy is at most 20 words each. Each step is a small anchored note (a popover next to the real control) with "Next" and "Skip guide".

| # | Anchor | Trigger | Copy |
|---|---|---|---|
| 1 | Command Center KPI strip | First load of home, after boot finishes and the sample-data note is dismissed | "This is Fernway Outfitters, a sample brand. Four numbers show how the season is going." |
| 2 | "What changed" feed | Step 1 done | "Eight agents work in the background. Their changes appear here, with View and Undo." |
| 3 | Approvals control | Step 2 done, or at least one proposal is waiting | "Changes agents can't make alone wait here. Open one to see the reason and the exact change." |
| 4 | First open proposal in the drawer | Drawer opened | "Check the reason and guardrails, then approve or dismiss. Dismissing pauses similar proposals." |
| 5 | Agents nav item | Proposal approved or dismissed | "Set each agent to Off, Suggest or Autopilot. Guardrails stay on either way." |
| 6 | Connect Claude button | Agents screen visited | "Optional: add your own Anthropic key and the agents use Claude. Without one, rules run everything." |

Step 3 is shown even when nothing waits: the copy changes to "Nothing waiting now. Proposals from agents will land here." only if the count is zero for 60 seconds.

### Trigger and anti-nagging rules

- Starts only on a first visit (no `firstRun` value in persisted UI state), only on the home route, never during boot or while a drawer, menu or dialog is open.
- Never interrupts: it waits for 3 seconds of no pointer or key input before showing each step, and never moves focus away from what the user is typing in.
- One step at a time, one non-modal popover, no toast, no badge, no sound.
- "Skip guide" and Escape end it for good. Navigating away or doing the anchored action on your own marks that step done without showing it.
- Closing the tab mid-guide resumes once on the next visit at the same step, then stops. Total prompts per person: at most 6 shown, at most 1 resume.
- Not shown when the URL has a deep-link hash other than home, under reduced motion it appears without animation, and never in automated runs (`navigator.webdriver`).
- Replay: "Show the guide again" in the overflow menu, next to "Show the sample-data note". It resets state.
- Stored in the existing persisted UI state (`mc.ui.v1`, the same place `sampleDismissed` lives) as `firstRun: {step, done, skipped}`. It is not part of the world or action log, so it never affects replay.

### Acceptance criteria

- [ ] Given a clean browser, when home loads and the sample note is dismissed, then step 1 appears after 3 seconds of idle and nothing else is covered.
- [ ] Given step 1 is shown, when the user presses Escape or "Skip guide", then no step appears on any later visit.
- [ ] Given the user opens the Approvals drawer unprompted, then step 3 is marked done and not shown.
- [ ] Given the guide is on step 4 and the user closes the tab, when they return, then step 4 resumes once, and after another close it does not return.
- [ ] Given a returning visitor with `firstRun.done` or `skipped`, then no step is shown.
- [ ] Given "Show the guide again" is chosen, then the guide restarts at step 1.
- [ ] Each popover is reachable by keyboard, announced with a polite live region, has a visible focus ring, and passes AA contrast in light and dark.
- [ ] The guide follows the design rules: no left-edge stripe, no gradient or glow, no emoji, sentence case, one primary button ("Next").
- [ ] The e2e suite (`tools/e2e.js`) pins a "guide disabled" flag so existing checks are unaffected, and has its own checks for the rules above.

### Metrics

- Share of first sessions with one proposal approved or dismissed (target 60%).
- Share of first sessions reaching Agents (target 50%).
- Skip rate at step 1 (investigate above 40%).
- Measured by hand in a moderated test, since the app has no analytics.

### Open questions

- Design: popover or inline callout style that fits the no-box rules.
- Engineering: how the anchors survive the feed re-rendering on every tick.
- Product: is a Connect Claude prompt appropriate for evaluators without a key?
