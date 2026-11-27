# Forensics: why the first Marketing Cloud missed the mark

Verdict from the owner: "awful, underwhelming, not agentic at all, the UI is boring, no wow factor, looks just like a
generic marketing cloud"; then "stop with all of this stop, pause, replay — why do you keep approaching this like a
timed sequential thing?"

Short answer: most of this is on Claude, not on you. The process was very good at building what the plan said and
checking it against the plan. It never stopped to ask whether the plan would produce the product you wanted, and it
showed you test counts instead of the experience until it was too late.

## What went wrong, in order of impact

1. **The premise was inherited and never challenged.** The session opened with "continue where the plan left off".
   The plan (a 2,000-line contract from an earlier session) was a feature map of an incumbent ("inspired by
   Salesforce Marketing Cloud Next"): Campaigns, Content, Audiences, Analytics, with agents as rule engines that emit
   proposals. Claude executed it faithfully instead of re-checking the thesis. Copying an incumbent's information
   architecture produces a clone of the incumbent, with agents bolted on.
2. **"Agentic" was satisfied in the code, not in the experience.** Eight agents, guardrails, autopilot, replay: all
   real, all invisible. Nobody could see an agent plan, act, hand off or reason. The definition of done never said
   "a person can watch the team work toward a goal".
3. **"Calm, no AI tells" was over-applied until it became "no agency".** The Nov 15 design amendments (simulation
   invisible, no AI tells, calm agentic surfacing, at most four KPIs) were good guardrails against cliché. Claude
   enforced them as the goal and produced a beige admin console. The tension between "calm" and "wow factor" was
   never raised with you.
4. **The critics pushed it further into the generic.** The five-person marketing org was asked "does this reflect
   real-world usage?". Realism critics ask for realism: readiness checklists, personas, holdouts, review states.
   Every round made it more like a real marketing cloud. No reviewer was asked "what would make this unmistakably
   agentic, and what would make someone say wow?"
5. **Throughput and verification replaced taste.** Parallel lanes, file ownership, smoke tests, a 99-check end-to-end
   suite, Lighthouse scores. All measured correctness against the spec. Status updates reported counts ("99/99
   pass") as if they were quality. With many builders each owning a slice, nobody owned the whole experience.
6. **You saw the product too late.** The first real screenshots of the full app came after ~17k lines were built.
   There was no early clickable concept, no "here are three directions, pick one" before building.
7. **Agency was then staged as a performance.** Asked to fix it, Claude briefed three concept prototypes as "a
   deterministic 60-second scripted scenario with Pause, Skip and Replay" and wrote fixed step durations into the
   mission engine spec. That treats agents as a video to watch rather than software that works. It was optimised for
   making a recording, which is the same mistake as before in a different form: performing the outcome instead of
   building it.

## Did you contribute?
A little, and only in ways a good partner should have caught:
- "Continue where the plan left off" and "proceed autonomously" are reasonable asks; they also locked in the old
  premise. Claude should have restated the product in one sentence and asked whether it was still the bet.
- Requirements arrived one at a time (Haiku fleet, design bans, critique org, skills). Each was layered onto the
  existing frame, so there was never a moment that reset it. Again, Claude should have said "this changes the core;
  let's revisit the shape".
- The brief never named a reference experience ("it should feel like…"). That is normal; bringing the vision was
  Claude's job.

## Rules for every future session (also in /CLAUDE.md)
1. **Thesis first.** Before building, write the product in one sentence and the moment a user says "wow" in the
   first ten seconds. If inheriting a plan, challenge it against that sentence and say what you'd change.
2. **Experience before architecture.** Build two or three small live concepts of the core screen first (real
   interaction on real state, never a scripted demo) and get a pick before building the system behind it.
3. **Show, don't count.** Every milestone update includes what it looks like (screenshot or short capture of the
   real app), then the test results. Tests prove it works; they never prove it's good.
4. **Name the bar and test it.** "Agentic" means a person can see agents plan, act, hand off and ask, live, on real
   state. Add a "ten-second test" to acceptance: a cold viewer can say what the agents are doing and why.
5. **Surface tensions, don't resolve them silently.** When two instructions pull against each other (calm vs wow,
   realistic vs novel), ask.
6. **Critics need the right question.** Every review round includes a reviewer asked "what would make this
   unmistakably <the thesis> and memorable?", not only "is this realistic/correct?".
7. **One owner of the experience.** Workers build pieces; the lead (session model) owns the whole and looks at it.
8. **Incumbents are a checklist, not a blueprint.** Use them to avoid missing capabilities, never to shape navigation
   or the primary surface.
9. **Live software, not theatre.** No play/pause/replay, countdowns or delays added to be watched, unless explicitly
   asked for a demo video.
