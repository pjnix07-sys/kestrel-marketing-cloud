# Demo: five minutes with the agents

Live at https://pjnix07-sys.github.io/kestrel-marketing-cloud/, or run it locally (see the README). There is nothing to set up and no scripted playback: the page is live software on a sample workspace whose data is as of now and moves in real time; agents work on a goal as soon as its inputs are ready, so a new goal is planned and under way within seconds. Nothing here needs a key. The sample tenant is Fernway Outfitters, a fictional outdoor retailer.

Before you start, open the page once and let it load (it builds 6,000 sample profiles and catches the world up to today). Use a wide window so the Lead column is open.

## The five minutes

**0:00 Land on the missions board.**
The page opens on the live missions. Say: "This isn't a dashboard of campaigns. It's a team of agents with a job. Read the headline." Point at the goal sentence of the first mission, "Win back 400 lapsed hikers before Dec 15 without discounting more than 15%." Then point at the lanes: each agent has a mark, a status dot and a line of what it is doing now.

**0:45 Follow the work.**
Click into the win-back mission. Show the steps laid out by dependency, not by time, and the orange hand-off wires between agents carrying their payload (an audience count, a budget split). Say: "Scout found the audience and handed it to the Planner. Fatigue Guard is removing people we've already messaged too much. Every one of these is a real action in the world: a real segment, a real campaign." Open an artifact panel to prove it.

**1:30 Answer the ask.**
The dark card is the only thing on the page that interrupts. Read the question, the why and the impact range aloud, then answer. Say: "It asks me once, with the reason, and it waits. No countdown." Watch the blocked step pick up as soon as you answer. Steps that did not depend on the answer kept going the whole time.

**2:15 Steer in plain language.**
Open "Talk to Lead". Type `Keep the discount under 10%` and send. Say: "I'm not editing a campaign. I'm telling the lead what I care about." Show Lead's one or two line reply and the plan changing on the board. Then try `skip SMS` and point at the channels dropping out.

**3:00 Give it a new goal.**
Click New goal and type `Grow Trail runners by 300 sign-ups by Dec 20 with no SMS`. Say: "I gave it an outcome, a date and a limit." Show Lead reading the sentence and drafting a plan, then the agents starting. If Lead can't tell something (the audience, the offer), it asks a clarifying question instead of guessing. Answer it.

**3:45 Open Content.**
Artifacts menu, then Content. In Compose, open a message. Say: "Written once, as blocks. Every channel version renders from the same source." Point at the email, SMS, push, social and web versions side by side, then flip the Data toggle to show the JSON a channel receives. Edit a shared headline and show the warning "used in N places", with the choice to change it everywhere or only in this message.

**4:30 Intelligence.**
Switch to Intelligence. Show the angle by channel grid: where trail-season headlines beat urgency, where they don't, with intervals and honest "not enough data" cells. Show the tired blocks and the agents' recommendations. Say: "Performance is measured per piece across channels, and the agents act on it. Copy Drafter writes from what's winning. Fatigue Guard proposes retiring what's worn out."

**5:00 Close.**
Back on the board: "While we talked, the world kept moving and the agents kept working. Every number is from the engine."

## What makes it agentic (talk track for execs)

- You hand over outcomes. The first thing you write is a sentence with a goal, a date and a limit. Campaigns, audiences and copy are what the agents make, and they stay inspectable and editable.
- You can see the work. Each agent has a name, a task and a status. Steps appear as they start, hand-offs are drawn, and the narration reads in each agent's voice. A cold viewer can say what the team is doing and why.
- You are asked only when it matters. An ask comes with the reason, the range of impact and what happens if you decline. Everything else proceeds.
- You steer in plain language, and the plan visibly re-forms. There is no form to fill in.
- It stays on. Insight Analyst checks every morning, updates progress against the target and Lead re-plans when pacing falls behind, and says so.
- It is accountable. Every step goes through the same action catalog, guardrails (consent, frequency caps, quiet hours, budget caps and more) and undo as a human change. The audit chain is deterministic and replayable.
- Content compounds. One message renders to every channel, performance is tracked per block, and what the agents learn feeds the next message.
- It works without Claude. The default brain is a deterministic rules planner. Connect your own Anthropic API key and the Lead plans free text and the specialists write with Claude Haiku 5.5. Only aggregated numbers are sent, and any failure falls back to rules.

## If something goes wrong

- A mission shows an ask you already answered elsewhere: open the Asks count in the top bar to see everything waiting.
- The board feels quiet: that is expected. Data moves in real time, and agent steps take about a second each, then wait for results. Answer a decision or set a new goal to see agents work.
- Want to replay the guided first run: overflow menu, then "Take the tour".
