# Marketing Cloud, agentic first (binding for the rebuild; supersedes the object-first navigation in CONTRACT §7)

## The problem we are fixing
The first build was a marketing cloud with automation attached: a sidebar of objects (Campaigns, Content,
Audiences, Analytics), agents hidden in a feed and a settings page, proposals that appear without anyone seeing
the work. It reads as a generic marketing cloud. The rebuild inverts it.

## Product in one sentence
You tell a team of marketing agents what outcome you want; you watch them plan it, do it, check each other, and
come to you only for the decisions that matter; campaigns, audiences and copy are things they make along the way.

## Principles
1. **Goals, not objects.** The primary unit is a **Mission**: an outcome, a deadline and constraints in one sentence.
   Campaigns, segments, variants and budgets are **artifacts** a mission produces. They stay inspectable and editable,
   but never lead the navigation.
2. **Agents are visible workers.** Each agent has a face (mark + colour + name), a current task, a status
   (planning, working, waiting on someone, idle) and a short running voice ("Found 412 lapsed hikers, 38 heard from us
   twice this week"). Work is shown as it happens, step by step, with hand-offs between agents.
3. **The human steers.** You set the goal and constraints, answer **asks** (one at a time, with the why, the impact
   range and what happens if you say no), and can **steer** any mission at any time in plain language
   ("keep the discount under 10%", "skip SMS", "pause until Monday"). Steering re-plans visibly.
4. **Always on.** Missions keep running as time passes: agents monitor results, notice drift and re-plan, and say so.
5. **Real actions.** Every step a mission takes goes through the existing action catalog, guardrails and undo. Nothing
   is faked; the artifacts are real objects in the world.
6. **Two brains, one experience.** With Claude connected, the lead agent plans from free text and the specialists
   reason and write with Haiku. Without a key, a deterministic planner handles the same goal shapes from templates
   and the existing rule agents do the work. The UI never badges which brain ran; Run history says Rules or Claude.

## Cast
- **Lead** (new orchestrator): turns your sentence into an objective and a plan, assigns steps, sequences hand-offs,
  re-plans on drift or steering, writes the narration.
- Specialists (existing, now step executors and monitors): **Segment Scout** (finds and sizes the audience),
  **Copy Drafter** (writes variants), **Fatigue Guard** (removes over-messaged people, protects unsubscribes),
  **Send-Time Tuner** (schedules sends), **Budget Pacer** (splits and paces spend), **Campaign Planner** (builds the
  journey and campaign), **Variant Optimizer** (shifts traffic once live), **Insight Analyst** (measures, flags drift,
  writes the result).

## Mission model (`js/core/missions.js`, world slice `missions`, logged catalog actions)
```
Mission = { id, title, goalText, objective: { metric: 'reactivations'|'revenue'|'orders'|'signups', target, by: day,
            constraints: [{kind:'maxDiscountPct'|'maxSpend'|'excludeChannel'|'maxSendsPerWeek'|..., value}] },
            status: 'planning'|'running'|'waiting'|'paused'|'done'|'stopped', createdTick, brain: 'rules'|'claude',
            plan: [Step], asks: [Ask], artifacts: [{kind, id}], log: [Beat], progress: {value, target, forecast, lo, hi} }
Step  = { id, agentId, title, needs: [stepId], status: 'queued'|'working'|'done'|'blocked'|'skipped',
          startedTick, doneTick, actions: [catalog action], artifact?: {kind, id}, note }
Ask   = { id, stepId, question, why, impact: {metric, lo, hi}, options: ['yes','no', ...], default, status, answer, by }
Beat  = { tick, agentId, kind: 'thought'|'handoff'|'did'|'ask'|'replan'|'result', text, ref? }   // the narration
```
Actions: `mission/create {goalText, objective?, plan?}`, `mission/step {id, stepId, patch}`,
`mission/ask {id, ask}`, `mission/answer {id, askId, answer}`, `mission/steer {id, text, constraints?}`,
`mission/setStatus {id, status}`. Results of planning (rules or Claude) are logged in payloads so replay is exact.

**Execution:** missions are event-driven and run on their own work pulse, separate from the world clock. The world clock
tracks real time (one tick is one real hour; the world is caught up to the real date and hour on boot, and a tab that slept
catches up the missed hours in one batch). While any mission has a step that is claimable or working (or an answered ask or
steer whose effect is pending), the engine runs one mission-work step about every second without moving the world clock; when
nothing is pending the pulse stops and no timer runs. Each pulse is the logged catalog action `mission/work`, so replay and
digests stay exact. A step is claimed on the pulse after its dependencies are ready and finishes on the next (a Claude-backed
step takes exactly as long as the real call); independent steps run in parallel. There are no artificial delays or step
durations. Answers and steering change mission state at once; any step they unblock is claimed on the next pulse. The world
clock still drives marketing results (sends, orders, revenue) and the daily monitoring: Insight Analyst checks in each morning,
updates progress, and Lead re-plans when pacing is behind. Asks have no auto-default or countdown; they wait for a human unless
the agent's autonomy explicitly allows proceeding.

**Deterministic planner (no key):** goal-shape templates: win-back / reactivation, launch a product, hit a revenue
number for an event, grow a segment, protect a list (fatigue). A small phrase parser extracts metric, target,
deadline, audience hints and constraints; anything unparsed becomes a clarifying ask from Lead.
**Claude planner:** Haiku returns the objective + plan (same schema, validated, grounded, guardrailed) via MC.ai.

## Seeded state (so the first view is alive)
Two missions already running at boot: "Win back 400 lapsed hikers before Dec 15 without discounting more than 15%"
(mid-execution, one ask waiting) and "Hit $48k on Black Friday Early Access" (monitoring, one re-plan in its history).
Existing campaigns become artifacts of these missions.

## Surfaces (visual direction chosen from concepts/; see docs/DESIGN-DIRECTION.md once picked)
1. **Missions** (home): the live missions, each showing its goal sentence, progress against target, the agents on it
   and what they are doing right now, and the next ask. A composer for a new goal is always one keystroke away.
2. **Mission view**: the plan being worked (steps, owners, hand-offs), the narration, the artifacts as they appear,
   the ask, and Steer.
3. **Team**: each agent's current work across missions, its record (applied, undone, realised impact), autonomy and
   reasoning settings.
4. **Artifacts**: campaigns, audiences, content, results, reachable from missions and a quiet secondary menu; the
   existing views are reused here, restyled, never the front door.
5. **Asks** inbox, Connect Claude, guided first run (rewritten for missions).

## Non-goals
No sidebar of objects as primary navigation. No dashboards of KPI tiles. No chat-only interface: conversation is for
steering, the work is shown, not described. No fake progress: every number comes from the engine.
